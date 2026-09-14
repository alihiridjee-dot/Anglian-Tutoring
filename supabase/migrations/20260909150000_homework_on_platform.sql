-- Homework as an on-platform activity, marked automatically and held for review.
--
-- Three changes travel together because they describe one new lifecycle:
--
--  1. `resources.origin` names where a homework came from. Two writers now
--     create homework — a tutor setting a brief, and the planner filling in the
--     one-sheet-per-spec-point library — and until now the only way to tell
--     them apart was to notice that only the second one ever set
--     `spec_point_id`. That is a coincidence of implementation, not a fact
--     about the row, and the homework list has to sort on it.
--
--  2. `homework_drafts` holds what a student has typed but not submitted.
--     Deliberately its own table rather than a status on `homework_submissions`:
--     the marking queue, the planner's coverage check and the parent progress
--     counts all read "a submission row exists" as "this was handed in", and
--     adding a draft state to that row would quietly change every one of them.
--
--  3. The marking columns stage an automatic mark without publishing it. The
--     mark is written the moment the work is submitted but held back for a day,
--     so a tutor has a window to correct it before anyone sees it. Staging is
--     what makes the hold real: `score_pct` is read directly by the predicted
--     grade and the planner's coverage without consulting `graded_at`, so a
--     mark written into the live columns "but hidden" would still move the
--     student's predicted grade the moment it landed.
--
-- Publishing is therefore a single step — `publish_homework_marks` — reached
-- either by a tutor confirming early or by the scheduled sweep once the day is
-- up. After it runs the row is indistinguishable from a hand-marked one, which
-- is the point: nothing downstream needs to learn a new shape.

-- ---------------------------------------------------------------------------
-- 1. Where a homework came from
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'resource_origin') then
    create type public.resource_origin as enum ('tutor', 'generated');
  end if;
end;
$$;

alter table public.resources
  add column if not exists origin public.resource_origin not null default 'tutor';

comment on column public.resources.origin is
  'Who created this. ''tutor'' is a deliberately set brief; ''generated'' is a '
  'library sheet the planner wrote for a spec point. Only homework uses this.';

-- Backfill. `ensure_generated_homework` is the only writer that has ever set
-- resources.spec_point_id, so it identifies the generated library exactly.
update public.resources
   set origin = 'generated'
 where kind = 'homework'
   and spec_point_id is not null
   and origin = 'tutor';

-- The student list segments on this, filtered to homework.
create index if not exists resources_homework_origin_idx
  on public.resources (origin, due_at)
  where kind = 'homework';

-- ---------------------------------------------------------------------------
-- 2. Answers typed but not yet handed in
-- ---------------------------------------------------------------------------

create table if not exists public.homework_drafts (
  student_id  uuid not null references auth.users (id) on delete cascade,
  resource_id uuid not null references public.resources (id) on delete cascade,
  -- { "<question_id>": "answer text" } — shaped for a partial write, since a
  -- draft is saved on nearly every keystroke pause.
  answers     jsonb not null default '{}'::jsonb,
  notes       text,
  updated_at  timestamptz not null default now(),
  primary key (student_id, resource_id)
);

alter table public.homework_drafts enable row level security;

-- A draft is private working-out. Not the tutor's, not the parent's — nobody
-- reads an unfinished answer but the person writing it.
drop policy if exists "hd own" on public.homework_drafts;
create policy "hd own" on public.homework_drafts
  for all
  using ((select auth.uid()) = student_id)
  with check ((select auth.uid()) = student_id);

grant select, insert, update, delete on public.homework_drafts to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Staged marks and the review window
-- ---------------------------------------------------------------------------

alter table public.homework_submissions
  add column if not exists ai_marked_at timestamptz,
  add column if not exists release_at timestamptz,
  add column if not exists tutor_reviewed_at timestamptz;

comment on column public.homework_submissions.release_at is
  'When the staged mark publishes itself if no tutor has got to it first.';

comment on column public.homework_submissions.tutor_reviewed_at is
  'When a human last confirmed or corrected this mark. Null means the mark '
  'published on the timer without being looked at.';

create index if not exists homework_submissions_pending_release_idx
  on public.homework_submissions (release_at)
  where graded_at is null and release_at is not null;

-- The staged mark itself lives in its own table, and this is the whole reason
-- why: `hs read scoped` lets a student SELECT their own submission row, so a
-- mark staged in a column beside it would be one REST call away from the person
-- it is being withheld from. Column privileges cannot help — a student and a
-- tutor both arrive as `authenticated`. A separate table can, because a student
-- has no policy on it at all.
create table if not exists public.homework_ai_marks (
  submission_id uuid primary key
    references public.homework_submissions (id) on delete cascade,
  -- [{ question_id, marks, feedback }]
  marks      jsonb not null,
  summary    text,
  model      text,
  created_at timestamptz not null default now()
);

alter table public.homework_ai_marks enable row level security;

-- Readable by the people who review it. Written only by the marker, which
-- holds the service role and bypasses RLS — no INSERT or UPDATE policy exists,
-- so there is no path for anyone else to stage a mark.
drop policy if exists "ham staff read" on public.homework_ai_marks;
create policy "ham staff read" on public.homework_ai_marks
  for select
  using (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    or private.has_role((select auth.uid()), 'admin'::public.app_role)
  );

grant select on public.homework_ai_marks to authenticated;

-- The grading trigger has to cover the new columns too.
--
-- Without this the hold is decorative: a student could POST their own
-- `ai_marks` and `release_at` in the past and let the scheduled publisher award
-- them full marks — laundering a self-graded paper through a trusted function.
-- Same reasoning as the original trigger, extended to the staging area.
create or replace function public.enforce_grading_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_privileged boolean;
begin
  -- `app.publishing_marks` is set, transaction-locally, only by
  -- `publish_homework_marks` and only around its own writes.
  --
  -- It exists because this trigger authorises on JWT claims and the scheduled
  -- publisher has no JWT: `auth.role()` and `auth.uid()` are both null under
  -- pg_cron, so the release that the whole review window depends on was being
  -- refused by its own guard — in a background job, where nothing would have
  -- reported it. A client cannot set this: PostgREST namespaces everything it
  -- forwards under `request.*` and exposes no way to run set_config.
  v_privileged :=
    coalesce(current_setting('app.publishing_marks', true), '') = 'on'
    or coalesce(auth.role(), '') = 'service_role'
    or private.has_role(auth.uid(), 'tutor'::public.app_role)
    or private.has_role(auth.uid(), 'admin'::public.app_role);

  if v_privileged then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.grade is not null
       or new.score_pct is not null
       or new.feedback is not null
       or new.graded_by is not null
       or new.graded_at is not null
       or new.ai_marked_at is not null
       or new.release_at is not null
       or new.tutor_reviewed_at is not null then
      raise exception 'Only tutors or admins may set grading fields'
        using errcode = '42501';
    end if;
  else
    if new.grade is distinct from old.grade
       or new.score_pct is distinct from old.score_pct
       or new.feedback is distinct from old.feedback
       or new.graded_by is distinct from old.graded_by
       or new.graded_at is distinct from old.graded_at
       or new.ai_marked_at is distinct from old.ai_marked_at
       or new.release_at is distinct from old.release_at
       or new.tutor_reviewed_at is distinct from old.tutor_reviewed_at then
      raise exception 'Only tutors or admins may set grading fields'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Publishing a staged mark
-- ---------------------------------------------------------------------------

-- Turns staged marks into a marked submission: per-question marks onto the
-- answers, the totals onto the submission, and a notification to the student.
--
-- Every mark is re-clamped to the question's own maximum here rather than
-- trusted from the staged JSON. The marker clamps too, but this is the last
-- gate before a number becomes a student's grade, and the staged blob has been
-- sitting in a table for a day by the time it is read.
--
-- Idempotent: a submission that already has `graded_at` is left exactly as it
-- is, so the timer firing on something a tutor published two minutes earlier is
-- a no-op rather than a silent overwrite of their corrections.
create or replace function public.publish_homework_marks(_submission_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _sub public.homework_submissions;
  _staged public.homework_ai_marks;
  _awarded numeric;
  _total numeric;
  _pct numeric;
  _title text;
begin
  -- The scheduled publisher runs with no JWT at all; everyone else must be
  -- staff. Notably absent: the student whose work this is.
  if auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not private.has_role(auth.uid(), 'tutor'::public.app_role)
     and not private.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only tutors or admins may publish marks'
      using errcode = '42501';
  end if;

  select * into _sub
    from public.homework_submissions
   where id = _submission_id
     for update;

  if not found then
    raise exception 'No such submission';
  end if;

  -- Already published.
  if _sub.graded_at is not null then
    return false;
  end if;

  select * into _staged
    from public.homework_ai_marks
   where submission_id = _submission_id;

  -- Nothing staged to publish — the marker never ran, or gave up. The work
  -- stays in the tutor's queue, which is where unmarkable work belongs.
  if not found then
    return false;
  end if;

  -- Announce the publish to `enforce_grading_privileges`, which otherwise sees
  -- a caller with no JWT and refuses. Transaction-local, so it lapses on its
  -- own the moment this returns — and it is set here, after every check above
  -- has passed, rather than at the top where an early return would leave it on.
  perform set_config('app.publishing_marks', 'on', true);

  update public.homework_answers a
     set awarded_marks = least(greatest(coalesce((m ->> 'marks')::numeric, 0), 0), q.marks),
         feedback = nullif(btrim(coalesce(m ->> 'feedback', '')), '')
    from jsonb_array_elements(coalesce(_staged.marks, '[]'::jsonb)) m
    join public.homework_questions q
      on q.id = (m ->> 'question_id')::uuid
   where a.submission_id = _submission_id
     and a.question_id = q.id;

  -- Totals come from the questions, not from the staged blob — an unanswered
  -- question still carries its marks into the denominator.
  select coalesce(sum(a.awarded_marks), 0), coalesce(sum(q.marks), 0)
    into _awarded, _total
    from public.homework_questions q
    left join public.homework_answers a
      on a.question_id = q.id and a.submission_id = _submission_id
   where q.resource_id = _sub.resource_id;

  _pct := case when _total > 0 then round((_awarded / _total) * 100) else null end;

  -- The grade is arithmetic on the marks, not a separate judgement — the same
  -- 1-9 ladder `gradeFromPct` applies in the app. Deriving it here as well as in
  -- the tutor's save is what stops a mark that published on the timer from
  -- reaching a parent with a percentage but no grade beside it.
  update public.homework_submissions
     set score_pct = _pct,
         grade = case
           when _pct is null then null
           when _pct >= 90 then '9' when _pct >= 80 then '8'
           when _pct >= 70 then '7' when _pct >= 60 then '6'
           when _pct >= 50 then '5' when _pct >= 40 then '4'
           when _pct >= 30 then '3' when _pct >= 20 then '2'
           else '1' end,
         feedback = coalesce(feedback, nullif(btrim(coalesce(_staged.summary, '')), '')),
         graded_at = now()
   where id = _submission_id;

  select r.title into _title
    from public.resources r
   where r.id = _sub.resource_id;

  insert into public.notifications (user_id, type, title, body, link, submission_id)
  values (
    _sub.student_id,
    'homework_marked',
    'Your homework has been marked',
    coalesce(_title, 'Homework') ||
      case when _pct is not null then ' — ' || _pct::text || '%' else '' end,
    '/homework/' || _sub.resource_id::text,
    _submission_id
  );

  return true;
end;
$$;

revoke all on function public.publish_homework_marks(uuid) from public, anon;
grant execute on function public.publish_homework_marks(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The timer
-- ---------------------------------------------------------------------------

-- Every five minutes, because the sweep's interval is added to every student's
-- wait. `release_at` is a per-submission deadline and this job is the only
-- thing that acts on it, so a quarter-hourly tick would stretch the promised
-- half hour to as much as forty-five minutes. The query is indexed and returns
-- nothing the vast majority of the time.
--
-- The batch cap is deliberate. If the publisher has been down, the backlog is
-- drained a few hundred at a time over successive runs instead of one
-- transaction taking a lock on every unmarked submission in the system.
select cron.unschedule('publish-homework-marks')
 where exists (select 1 from cron.job where jobname = 'publish-homework-marks');

select cron.schedule(
  'publish-homework-marks',
  '*/5 * * * *',
  $cron$
    select public.publish_homework_marks(s.id)
      from public.homework_submissions s
      join public.homework_ai_marks m on m.submission_id = s.id
     where s.graded_at is null
       and s.release_at <= now()
     order by s.release_at
     limit 200;
  $cron$
);

-- ---------------------------------------------------------------------------
-- 6. Generated homework carries its origin
-- ---------------------------------------------------------------------------

create or replace function public.ensure_generated_homework(
  _spec_point_id uuid,
  _title text,
  _subject public.subject,
  _level public.level,
  _questions jsonb,
  _board public.board default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _resource_id uuid;
begin
  if _uid is null then
    raise exception 'Not signed in';
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
    (kind, title, subject, board, level, spec_point_id, created_by, origin)
  values
    ('homework', _title, _subject, _board, _level, _spec_point_id, _uid, 'generated')
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

-- ---------------------------------------------------------------------------
-- 7. Submitting: no files left to carry
-- ---------------------------------------------------------------------------

-- Homework is answered on the page. Nothing is uploaded and nothing is handed
-- in as a document, so the submission no longer collects attachment metadata.
-- Stopping the writer is what makes the columns droppable; the drop itself is
-- the follow-up migration, once the deployed app has stopped reading them.
--
-- It also clears the draft, so handing work in and reopening the sheet doesn't
-- offer to restore the answers that were just submitted.
create or replace function public.submit_homework_answers(
  _resource_id uuid,
  _answers jsonb,
  _notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _submission_id uuid;
begin
  if _uid is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1 from public.resources r where r.id = _resource_id and r.kind = 'homework'
  ) then
    raise exception 'That homework does not exist';
  end if;

  if exists (
    select 1 from public.homework_submissions s
    where s.resource_id = _resource_id and s.student_id = _uid
  ) then
    raise exception 'You have already submitted this homework';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a
    where not exists (
      select 1 from public.homework_questions q
      where q.id = (a ->> 'question_id')::uuid and q.resource_id = _resource_id
    )
  ) then
    raise exception 'An answer refers to a question that is not on this homework';
  end if;

  insert into public.homework_submissions (resource_id, student_id, notes, submitted_at)
  values (_resource_id, _uid, nullif(btrim(coalesce(_notes, '')), ''), now())
  returning id into _submission_id;

  insert into public.homework_answers (submission_id, question_id, answer_text)
  select
    _submission_id,
    (a ->> 'question_id')::uuid,
    nullif(btrim(coalesce(a ->> 'answer_text', '')), '')
  from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a;

  -- The working-out has been handed in; the draft has nothing left to restore.
  delete from public.homework_drafts
   where student_id = _uid and resource_id = _resource_id;

  return _submission_id;
end;
$$;
