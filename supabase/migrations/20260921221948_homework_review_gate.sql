-- A tutor's gate in front of generated homework, and the pieces the grading
-- review needs: mark drafts and student groups.
--
-- Until now a generated sheet was live the moment it was written. That was fine
-- while sheets were written for the week a student was already in — there was
-- no window to review anything in. The planner now also writes *next* week's
-- sheets ahead of time, which creates one: a sheet nobody needs until Monday
-- can wait for a tutor to read it.
--
-- The gate is three states on `resources`:
--   to_review — written, not yet read by a tutor
--   approved  — a tutor passed it (every sheet that predates this is approved)
--   held      — a tutor pulled it; students never see it
--
-- "Auto-publish on Monday" is not a job. A `to_review` sheet carries the moment
-- it goes live in `publish_at`, and the read policy compares that with now().
-- Nothing has to run for a sheet to publish, so nothing can fail to.

-- ---------------------------------------------------------------------------
-- 1. The gate
-- ---------------------------------------------------------------------------

alter table public.resources
  add column if not exists review_status text not null default 'approved'
    check (review_status in ('to_review', 'approved', 'held')),
  add column if not exists publish_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users (id) on delete set null,
  add column if not exists reviewed_at timestamptz;

comment on column public.resources.review_status is
  'Tutor gate for generated homework: to_review, approved or held. Held is never shown to students.';
comment on column public.resources.publish_at is
  'When a to_review sheet goes live on its own. Null or past means live now.';

-- The review queue is "everything not yet approved", which stays small however
-- large the library grows.
create index if not exists resources_review_queue_idx
  on public.resources (review_status, publish_at)
  where kind = 'homework' and review_status <> 'approved';

-- Students and parents stop at the gate; tutors read everything, as before.
--
-- The last clause keeps a sheet readable by anyone who can already see a
-- submission against it. Holding a sheet after work has come in must not make
-- that child's marked homework vanish from their own dashboard — `held` stops
-- new students reaching a sheet, it does not unpublish history.
-- `homework_submissions` is itself row-scoped to the student and their linked
-- parents, so the subquery cannot widen what anyone sees.
drop policy if exists "resources read scoped" on public.resources;
create policy "resources read scoped" on public.resources
  for select to authenticated
  using (
    (select private.has_role((select auth.uid()), 'tutor'::public.app_role))
    or (
      (subject)::text in (select unnest(private.my_content_subjects()))
      and (
        review_status = 'approved'
        or (review_status = 'to_review' and (publish_at is null or publish_at <= now()))
        or exists (
          select 1 from public.homework_submissions s where s.resource_id = resources.id
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Generated sheets arrive at the gate
-- ---------------------------------------------------------------------------

-- Same writer, one new argument. `_publish_at` is the Monday a sheet written
-- ahead of time is for; left out, the sheet is for a week already under way and
-- goes live at once — still `to_review`, so it shows in the tutor's table as
-- live and unread rather than disappearing from it.
drop function if exists public.ensure_generated_homework(
  uuid, text, public.subject, public.level, jsonb, uuid, public.board
);

create function public.ensure_generated_homework(
  _spec_point_id uuid,
  _title text,
  _subject public.subject,
  _level public.level,
  _questions jsonb,
  _created_by uuid,
  _board public.board default null,
  _publish_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _resource_id uuid;
begin
  if _created_by is null then
    raise exception 'A generated homework needs the user it was made for';
  end if;

  -- Already generated, possibly by another student moments ago.
  select r.id into _resource_id
  from public.resources r
  where r.kind = 'homework' and r.spec_point_id = _spec_point_id;
  if _resource_id is not null then
    return _resource_id;
  end if;

  if not exists (select 1 from public.spec_points sp where sp.id = _spec_point_id) then
    raise exception 'Unknown spec point';
  end if;

  if _questions is null or jsonb_array_length(_questions) = 0 then
    raise exception 'Refusing to create a homework with no questions';
  end if;

  insert into public.resources
    (kind, title, subject, board, level, spec_point_id, created_by, origin,
     review_status, publish_at)
  values
    ('homework', _title, _subject, _board, _level, _spec_point_id, _created_by, 'generated',
     'to_review', coalesce(_publish_at, now()))
  on conflict (spec_point_id) where kind = 'homework' and spec_point_id is not null
  do nothing
  returning id into _resource_id;

  -- Lost the race: the winner's sheet is the one everybody uses.
  if _resource_id is null then
    select r.id into _resource_id
    from public.resources r
    where r.kind = 'homework' and r.spec_point_id = _spec_point_id;
    return _resource_id;
  end if;

  insert into public.homework_questions
    (resource_id, position, prompt, marks, answer_type, mark_scheme, spec_point_id)
  select
    _resource_id,
    (t.ord - 1)::int,
    t.q ->> 'prompt',
    greatest(1, least(30, coalesce((t.q ->> 'marks')::int, 2))),
    case when t.q ->> 'answer_type' in ('short', 'long', 'numeric')
         then t.q ->> 'answer_type' else 'short' end,
    nullif(btrim(coalesce(t.q ->> 'mark_scheme', '')), ''),
    _spec_point_id
  from jsonb_array_elements(_questions) with ordinality as t(q, ord)
  where nullif(btrim(coalesce(t.q ->> 'prompt', '')), '') is not null;

  insert into public.resource_spec_points (resource_id, spec_point_id)
  values (_resource_id, _spec_point_id)
  on conflict do nothing;

  return _resource_id;
end;
$$;

revoke all on function public.ensure_generated_homework(
  uuid, text, public.subject, public.level, jsonb, uuid, public.board, timestamptz
) from public, anon, authenticated;
grant execute on function public.ensure_generated_homework(
  uuid, text, public.subject, public.level, jsonb, uuid, public.board, timestamptz
) to service_role;

-- Which of these spec points already have a sheet, *whether or not the caller
-- may read it*.
--
-- The generator used to ask `resources` directly, under the student's own
-- session. With the gate in place a held or not-yet-published sheet is invisible
-- there, so the generator would conclude it was missing and pay the model to
-- write it again on every visit — only for the writer above to throw the result
-- away. This answers the one question it actually has. It reveals that a sheet
-- exists for a point, never what is in it.
create or replace function public.homework_points_with_sheet(_spec_point_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.spec_point_id
  from public.resources r
  where (select auth.uid()) is not null
    and r.kind = 'homework'
    and r.spec_point_id = any (_spec_point_ids);
$$;

revoke all on function public.homework_points_with_sheet(uuid[]) from public, anon;
grant execute on function public.homework_points_with_sheet(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Saving a mark without publishing it
-- ---------------------------------------------------------------------------

-- A tutor's half-finished corrections, kept where the proposal they are
-- correcting lives.
--
-- They cannot go onto `homework_answers`: `publish_homework_marks` writes the
-- staged marks over those rows, so a draft saved there would be silently
-- replaced by the model's original numbers when the timer fired. Staging the
-- tutor's version instead means whatever publishes — their own click or the
-- clock — publishes what they last saved.
--
-- `tutor_reviewed_at` with no `graded_at` is what the queue reads as "Edited".
create or replace function public.save_homework_mark_draft(
  _submission_id uuid,
  _marks jsonb,
  _summary text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _sub public.homework_submissions;
  _clean jsonb;
begin
  if not private.has_role((select auth.uid()), 'tutor'::public.app_role)
     and not private.has_role((select auth.uid()), 'admin'::public.app_role) then
    raise exception 'Only tutors or admins may save marks' using errcode = '42501';
  end if;

  select * into _sub
    from public.homework_submissions
   where id = _submission_id
     for update;
  if not found then
    raise exception 'No such submission';
  end if;
  if _sub.graded_at is not null then
    raise exception 'This submission is already published';
  end if;

  -- Keep only marks for this sheet's own questions, clamped to each maximum —
  -- the same rule the publisher applies, applied on the way in as well.
  select coalesce(jsonb_agg(jsonb_build_object(
           'question_id', q.id,
           'marks', least(greatest(coalesce((m ->> 'marks')::numeric, 0), 0), q.marks),
           'feedback', coalesce(m ->> 'feedback', '')
         )), '[]'::jsonb)
    into _clean
    from jsonb_array_elements(coalesce(_marks, '[]'::jsonb)) m
    join public.homework_questions q
      on q.id = (m ->> 'question_id')::uuid
     and q.resource_id = _sub.resource_id
   where nullif(btrim(coalesce(m ->> 'marks', '')), '') is not null;

  insert into public.homework_ai_marks (submission_id, marks, summary)
  values (_submission_id, _clean, nullif(btrim(coalesce(_summary, '')), ''))
  on conflict (submission_id) do update
    set marks = excluded.marks,
        summary = excluded.summary;

  update public.homework_submissions
     set tutor_reviewed_at = now()
   where id = _submission_id;
end;
$$;

revoke all on function public.save_homework_mark_draft(uuid, jsonb, text) from public, anon;
grant execute on function public.save_homework_mark_draft(uuid, jsonb, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Student groups
-- ---------------------------------------------------------------------------

-- Sets a tutor makes by hand ("Tuesday set"). Cohorts that follow from
-- enrolments are derived in the app and need no table.
--
-- Staff only, in both directions. A group name can say something about the
-- children in it, and membership is a list of minors, so neither is readable by
-- students or parents — there is no policy for them at all.
create table if not exists public.student_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.student_group_members (
  group_id uuid not null references public.student_groups (id) on delete cascade,
  student_id uuid not null references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, student_id)
);

create index if not exists student_group_members_student_idx
  on public.student_group_members (student_id);

alter table public.student_groups enable row level security;
alter table public.student_group_members enable row level security;

drop policy if exists "sg staff all" on public.student_groups;
create policy "sg staff all" on public.student_groups
  for all to authenticated
  using (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    or private.has_role((select auth.uid()), 'admin'::public.app_role)
  )
  with check (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    or private.has_role((select auth.uid()), 'admin'::public.app_role)
  );

drop policy if exists "sgm staff all" on public.student_group_members;
create policy "sgm staff all" on public.student_group_members
  for all to authenticated
  using (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    or private.has_role((select auth.uid()), 'admin'::public.app_role)
  )
  with check (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    or private.has_role((select auth.uid()), 'admin'::public.app_role)
  );

revoke all on public.student_groups, public.student_group_members from anon;
grant select, insert, update, delete
  on public.student_groups, public.student_group_members to authenticated;

notify pgrst, 'reload schema';
