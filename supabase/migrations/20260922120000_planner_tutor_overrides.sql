-- Tutor overrides on the weekly planner.
--
-- A tutor could add work to a student's week (a plan-point row with origin
-- `tutor`, which every re-cut keeps) but could not lastingly take work out of
-- it: deleting an automatic row left no record, so the next cut — the student
-- opening the week, a catch-up top-up, a topic reorder — put the point back.
-- This migration gives the removal a row of its own, and makes every automatic
-- write honour it.
--
--   student_plan_overrides   `remove` (point, week) or `skip` (point, all weeks)
--   enforce_plan_overrides   trigger: an automatic write of an overridden point
--                            is dropped, whatever client made it
--   save_weekly_plan         filters overridden automatic points out of a re-cut
--   remove_plan_point        tutor RPC: take a point out of one week
--   skip_plan_point          tutor RPC: keep a point out of the programme
--   reorder_student_topics   now callable by a tutor on a student's behalf
--   plan_point_has_work      one definition of "the student worked on this"
--
-- Hand-picked rows (`student` / `tutor`) are exempt everywhere: a pin outranks
-- an override. Student work is protected as before: a point with a submission,
-- an attempt or a tick in the week is never deleted by a removal.
--
-- Idempotent. Rollback: supabase/rollbacks/20260922120000_planner_tutor_overrides.down.sql

begin;

-- ── 1 · The override record ───────────────────────────────────────────────

do $$ begin
  if not exists (select 1 from pg_type where typname = 'plan_override_kind') then
    create type public.plan_override_kind as enum ('remove', 'skip');
  end if;
end $$;

create table if not exists public.student_plan_overrides (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references auth.users(id) on delete cascade,
  subject       public.subject not null,
  spec_point_id uuid not null references public.spec_points(id) on delete cascade,
  kind          public.plan_override_kind not null,
  -- Monday of the week a `remove` names; null for a `skip`.
  week_start    date,
  note          text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint plan_override_week_matches_kind
    check ((kind = 'remove') = (week_start is not null)),
  constraint plan_override_week_is_monday
    check (week_start is null or extract(isodow from week_start) = 1),
  constraint plan_override_note_length check (note is null or length(note) <= 500)
);

comment on table public.student_plan_overrides is
  'A tutor''s decision that the programme may not schedule a spec point: into one week (remove) or at all (skip). Hand-picked plan points are exempt.';
comment on column public.student_plan_overrides.week_start is
  'Monday of the week a remove applies to; null for a skip, which applies to every week.';

-- One override per (student, subject, point, kind, week). The coalesce lets a
-- skip's null week take part in the key.
create unique index if not exists student_plan_overrides_unique
  on public.student_plan_overrides
  (student_id, subject, spec_point_id, kind, (coalesce(week_start, date '0001-01-01')));
create index if not exists idx_plan_overrides_student_subject
  on public.student_plan_overrides (student_id, subject);
create index if not exists idx_plan_overrides_spec_point
  on public.student_plan_overrides (spec_point_id);

alter table public.student_plan_overrides enable row level security;

-- Students see what their tutor decided; tutors and admins manage it; a linked
-- parent may read. Writes go through the RPCs below, but the tutor policy also
-- allows a direct delete (clearing an override).
drop policy if exists "spo own" on public.student_plan_overrides;
create policy "spo own" on public.student_plan_overrides
  for select to authenticated
  using (auth.uid() = student_id);

drop policy if exists "spo tutor" on public.student_plan_overrides;
create policy "spo tutor" on public.student_plan_overrides
  for all to authenticated
  using (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role))
  with check (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role));

drop policy if exists "spo parent" on public.student_plan_overrides;
create policy "spo parent" on public.student_plan_overrides
  for select to authenticated
  using (exists (
    select 1 from public.parent_student_links l
    where l.parent_id = auth.uid() and l.student_id = student_plan_overrides.student_id
  ));

-- The point must be on the subject the override names.
create or replace function public.enforce_plan_override_course()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from spec_points sp join topics t on t.id = sp.topic_id
    where sp.id = new.spec_point_id and t.subject = new.subject
  ) then
    raise exception 'spec point % is not on subject %', new.spec_point_id, new.subject
      using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists plan_override_course on public.student_plan_overrides;
create trigger plan_override_course
  before insert or update of spec_point_id, subject on public.student_plan_overrides
  for each row execute function public.enforce_plan_override_course();

-- ── 2 · "The student worked on this point in this week" ───────────────────

-- The immunity test `save_weekly_plan` has always applied, named so the removal
-- RPCs apply exactly the same one. Even ungraded submissions are student work.
-- The plan's week is a London calendar week; both direct and junction/question
-- source links count.
create or replace function public.plan_point_has_work(
  _student_id uuid, _spec_point_id uuid, _week_start date
) returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
      select 1 from homework_submissions h
      join resources r on r.id = h.resource_id
      where h.student_id = _student_id and r.kind = 'homework'
        and h.submitted_at >= (_week_start::timestamp at time zone 'Europe/London')
        and h.submitted_at < ((_week_start + 7)::timestamp at time zone 'Europe/London')
        and (r.spec_point_id = _spec_point_id or exists (
          select 1 from resource_spec_points l
          where l.resource_id = r.id and l.spec_point_id = _spec_point_id))
    )
    or exists (
      select 1 from mcq_attempts a
      where a.user_id = _student_id
        and a.created_at >= (_week_start::timestamp at time zone 'Europe/London')
        and a.created_at < ((_week_start + 7)::timestamp at time zone 'Europe/London')
        and (a.point_scores ? _spec_point_id::text or exists (
          select 1 from mcq_sets m where m.id = a.set_id and m.spec_point_id = _spec_point_id
        ) or exists (
          select 1 from mcq_questions q where q.set_id = a.set_id and q.spec_point_id = _spec_point_id
        ))
    );
$$;
revoke all on function public.plan_point_has_work(uuid, uuid, date) from public, anon;
grant execute on function public.plan_point_has_work(uuid, uuid, date) to authenticated;

-- ── 3 · The one rule, at the table ────────────────────────────────────────

-- An automatic write of an overridden point is dropped rather than refused:
-- the scheduler writes whole weeks in one statement, and one suppressed row
-- must not fail the other twenty. Hand-picked origins pass — the pin wins.
-- SECURITY DEFINER so an override the caller cannot read never reads as absent.
create or replace function public.enforce_plan_overrides()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _plan record;
begin
  if new.origin in ('student'::plan_point_origin, 'tutor'::plan_point_origin) then
    return new;
  end if;
  select p.student_id, p.subject, p.week_start into _plan
  from student_weekly_plans p where p.id = new.plan_id;
  if not found then
    return new; -- the foreign key owns this case
  end if;
  if exists (
    select 1 from student_plan_overrides o
    where o.student_id = _plan.student_id
      and o.subject = _plan.subject
      and o.spec_point_id = new.spec_point_id
      and (o.kind = 'skip' or (o.kind = 'remove' and o.week_start = _plan.week_start))
  ) then
    return null;
  end if;
  return new;
end
$$;

drop trigger if exists plan_point_overrides on public.student_weekly_plan_points;
create trigger plan_point_overrides
  before insert or update of origin, spec_point_id, plan_id on public.student_weekly_plan_points
  for each row execute function public.enforce_plan_overrides();

-- ── 4 · save_weekly_plan honours overrides ────────────────────────────────

-- Same contract as before, with two changes: automatic incoming points the
-- tutor has removed from this week or skipped are filtered out before the
-- write, so an older client's re-cut cannot reinstate them; and the immunity
-- test is the shared `plan_point_has_work`.
create or replace function public.save_weekly_plan(
  _student_id uuid,
  _subject subject,
  _board board,
  _level level,
  _week_start date,
  _source plan_source,
  _rationale text,
  _points jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  _plan_id uuid;
  _count int;
  _incoming jsonb;
begin
  if jsonb_typeof(coalesce(_points, '[]'::jsonb)) <> 'array' then
    raise exception 'points must be an array';
  end if;

  -- The programme may not place an overridden point; a person may.
  select coalesce(jsonb_agg(e), '[]'::jsonb) into _incoming
  from jsonb_array_elements(coalesce(_points, '[]'::jsonb)) e
  where coalesce((e->>'origin')::plan_point_origin, 'ai'::plan_point_origin)
        in ('student'::plan_point_origin, 'tutor'::plan_point_origin)
     or not exists (
      select 1 from student_plan_overrides o
      where o.student_id = _student_id and o.subject = _subject
        and o.spec_point_id = (e->>'spec_point_id')::uuid
        and (o.kind = 'skip' or (o.kind = 'remove' and o.week_start = _week_start))
    );

  _count := jsonb_array_length(_incoming);
  if _count > 200 then
    raise exception 'a week cannot hold more than 200 spec points';
  end if;

  insert into student_weekly_plans
    (student_id, subject, board, level, week_start, source, ai_rationale, updated_at)
  values
    (_student_id, _subject, _board, _level, _week_start, _source, _rationale, now())
  on conflict (student_id, subject, week_start) do update
    set board        = excluded.board,
        level        = excluded.level,
        source       = excluded.source,
        ai_rationale = excluded.ai_rationale,
        updated_at   = now()
  returning id into _plan_id;

  -- Replace only unprotected points, retaining completion and explicit choices.
  delete from student_weekly_plan_points p where p.plan_id = _plan_id
    and p.done_at is null and p.carried_from is null
    and p.origin not in ('student'::plan_point_origin, 'tutor'::plan_point_origin)
    and not plan_point_has_work(_student_id, p.spec_point_id, _week_start)
    and not exists (select 1 from jsonb_array_elements(_incoming) e
      where (e->>'spec_point_id')::uuid = p.spec_point_id);

  insert into student_weekly_plan_points (plan_id, spec_point_id, origin, carried_from)
  select
    _plan_id,
    (e->>'spec_point_id')::uuid,
    coalesce((e->>'origin')::plan_point_origin, 'ai'::plan_point_origin),
    nullif(e->>'carried_from', '')::date
  from jsonb_array_elements(_incoming) e
  on conflict (plan_id, spec_point_id) do update
    set origin = excluded.origin, carried_from = excluded.carried_from;
  -- Existing done_at values survive: completing work is never undone by a re-cut.

  return _plan_id;
end
$$;

revoke all on function public.save_weekly_plan(uuid, subject, board, level, date, plan_source, text, jsonb) from public;
grant execute on function public.save_weekly_plan(uuid, subject, board, level, date, plan_source, text, jsonb) to authenticated;

-- ── 5 · Tutor RPCs ────────────────────────────────────────────────────────

create or replace function public.plan_override_caller_is_tutor()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select private.has_role(auth.uid(), 'tutor'::app_role)
      or private.has_role(auth.uid(), 'admin'::app_role);
$$;
revoke all on function public.plan_override_caller_is_tutor() from public, anon;
grant execute on function public.plan_override_caller_is_tutor() to authenticated;

-- Take a point out of one week, and record that the programme may not put it
-- back. Returns what happened:
--   removed  — a plan row was deleted
--   blocked  — a `remove` override now stands for this week
--   reason   — 'worked' when the student has already done work on it (nothing
--              changes: their work outranks the tutor's edit), else null
--   origin   — the deleted row's origin, or null
create or replace function public.remove_plan_point(
  _student_id uuid,
  _subject subject,
  _spec_point_id uuid,
  _week_start date,
  _note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  _this_monday date := date_trunc('week', now() at time zone 'Europe/London')::date;
  _plan_id uuid;
  _row record;
  _removed boolean := false;
begin
  if not plan_override_caller_is_tutor() then
    raise exception 'Only a tutor can change a student''s plan.' using errcode = '42501';
  end if;
  if extract(isodow from _week_start) <> 1 then
    raise exception 'Choose a Monday.' using errcode = '22023';
  end if;
  if _week_start < _this_monday then
    raise exception 'Past weeks are history and cannot be changed.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from spec_points sp join topics t on t.id = sp.topic_id
    where sp.id = _spec_point_id and t.subject = _subject
  ) then
    raise exception 'That spec point is not on this subject.' using errcode = '23514';
  end if;

  select id into _plan_id from student_weekly_plans
    where student_id = _student_id and subject = _subject and week_start = _week_start
    for update;
  if _plan_id is not null then
    select * into _row from student_weekly_plan_points
      where plan_id = _plan_id and spec_point_id = _spec_point_id for update;
    if found then
      if _row.done_at is not null or plan_point_has_work(_student_id, _spec_point_id, _week_start) then
        return jsonb_build_object('removed', false, 'blocked', false, 'reason', 'worked',
          'origin', _row.origin);
      end if;
      delete from student_weekly_plan_points
        where plan_id = _plan_id and spec_point_id = _spec_point_id;
      _removed := true;
    end if;
  end if;

  insert into student_plan_overrides (student_id, subject, spec_point_id, kind, week_start, note, created_by)
  values (_student_id, _subject, _spec_point_id, 'remove', _week_start, nullif(trim(_note), ''), auth.uid())
  on conflict (student_id, subject, spec_point_id, kind, (coalesce(week_start, date '0001-01-01')))
  do update set note = excluded.note, created_by = excluded.created_by, created_at = now();

  return jsonb_build_object('removed', _removed, 'blocked', true, 'reason', null,
    'origin', case when _removed then _row.origin::text end);
end
$$;
revoke all on function public.remove_plan_point(uuid, subject, uuid, date, text) from public, anon;
grant execute on function public.remove_plan_point(uuid, subject, uuid, date, text) to authenticated;

-- Keep a point out of the programme altogether. Clears it from every current
-- and future week where it sits unprotected and automatic; past weeks are
-- history and pins are the tutor's own. Returns:
--   removed       — how many plan rows were deleted
--   pinned_weeks  — current/future weeks still holding it hand-picked
--   worked_weeks  — current/future weeks where the student's work kept it
create or replace function public.skip_plan_point(
  _student_id uuid,
  _subject subject,
  _spec_point_id uuid,
  _note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  _this_monday date := date_trunc('week', now() at time zone 'Europe/London')::date;
  _removed int := 0;
  _pinned jsonb;
  _worked jsonb;
begin
  if not plan_override_caller_is_tutor() then
    raise exception 'Only a tutor can change a student''s plan.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from spec_points sp join topics t on t.id = sp.topic_id
    where sp.id = _spec_point_id and t.subject = _subject
  ) then
    raise exception 'That spec point is not on this subject.' using errcode = '23514';
  end if;

  insert into student_plan_overrides (student_id, subject, spec_point_id, kind, week_start, note, created_by)
  values (_student_id, _subject, _spec_point_id, 'skip', null, nullif(trim(_note), ''), auth.uid())
  on conflict (student_id, subject, spec_point_id, kind, (coalesce(week_start, date '0001-01-01')))
  do update set note = excluded.note, created_by = excluded.created_by, created_at = now();

  with gone as (
    delete from student_weekly_plan_points pp
    using student_weekly_plans wp
    where wp.id = pp.plan_id
      and wp.student_id = _student_id and wp.subject = _subject
      and pp.spec_point_id = _spec_point_id
      and wp.week_start >= _this_monday
      and pp.origin not in ('student'::plan_point_origin, 'tutor'::plan_point_origin)
      and pp.done_at is null
      and not plan_point_has_work(_student_id, _spec_point_id, wp.week_start)
    returning pp.plan_id
  )
  select count(*) into _removed from gone;

  select coalesce(jsonb_agg(wp.week_start order by wp.week_start), '[]'::jsonb) into _pinned
  from student_weekly_plans wp join student_weekly_plan_points pp on pp.plan_id = wp.id
  where wp.student_id = _student_id and wp.subject = _subject
    and pp.spec_point_id = _spec_point_id and wp.week_start >= _this_monday
    and pp.origin in ('student'::plan_point_origin, 'tutor'::plan_point_origin);

  select coalesce(jsonb_agg(wp.week_start order by wp.week_start), '[]'::jsonb) into _worked
  from student_weekly_plans wp join student_weekly_plan_points pp on pp.plan_id = wp.id
  where wp.student_id = _student_id and wp.subject = _subject
    and pp.spec_point_id = _spec_point_id and wp.week_start >= _this_monday
    and pp.origin not in ('student'::plan_point_origin, 'tutor'::plan_point_origin);

  return jsonb_build_object('removed', _removed, 'pinned_weeks', _pinned, 'worked_weeks', _worked);
end
$$;
revoke all on function public.skip_plan_point(uuid, subject, uuid, text) from public, anon;
grant execute on function public.skip_plan_point(uuid, subject, uuid, text) to authenticated;

-- ── 6 · Topic reordering on a student's behalf ────────────────────────────

-- Same body as 20260915120000, with one new trailing parameter. A tutor or
-- admin passes `_student_id`; a student leaves it null and, as before, is bound
-- to auth.uid(). Overridden points fall out of the re-cut weeks in
-- `save_weekly_plan`, which this calls.
drop function if exists public.reorder_student_topics(subject, board, level, date, jsonb, date, jsonb, uuid[], jsonb);

create or replace function public.reorder_student_topics(
  _subject public.subject, _board public.board, _level public.level,
  _from date, _expected_pacing jsonb, _expected_exam date,
  _pacing jsonb, _assessed uuid[] default '{}', _reviews jsonb default '[]'::jsonb,
  _student_id uuid default null
) returns void language plpgsql security invoker set search_path = public as $$
declare
  _student uuid := coalesce(_student_id, auth.uid());
  _saved public.student_program_plan%rowtype;
  _week record;
  _points jsonb;
  _count integer;
  _protected jsonb;
begin
  if _student is null then raise exception 'Sign in to change topic order.'; end if;
  if _student <> auth.uid() and not plan_override_caller_is_tutor() then
    raise exception 'Only the student or their tutor can change their topic order.' using errcode = '42501';
  end if;
  select * into _saved from student_program_plan
    where student_id = _student and subject = _subject for update;
  if not found then raise exception 'Open the planner before changing topic order.'; end if;
  if (select coalesce(jsonb_agg(b), '[]'::jsonb) from jsonb_array_elements(_saved.pacing) b where coalesce(b->>'kind','teach')='teach')
    is distinct from (select coalesce(jsonb_agg(b), '[]'::jsonb) from jsonb_array_elements(_expected_pacing) b where coalesce(b->>'kind','teach')='teach')
    or _saved.exam_date is distinct from _expected_exam then
    raise exception 'The plan changed in another window. Reload and preview the order again.';
  end if;
  if _from < date_trunc('week', now() at time zone 'Europe/London')::date
    or extract(isodow from _from) <> 1 or _from >= _saved.exam_date then
    raise exception 'Choose a current or future Monday before the exams.';
  end if;
  if not exists (select 1 from student_enrolments where student_id = _student and subject = _subject and board = _board)
    or not exists (select 1 from profiles where id = _student and level = _level) then
    raise exception 'The course changed. Reload the planner.';
  end if;
  if jsonb_typeof(_pacing) <> 'array' or jsonb_array_length(_pacing) = 0 or jsonb_array_length(_pacing) > 500 then
    raise exception 'Invalid topic order.';
  end if;
  if exists (select 1 from jsonb_array_elements(_pacing) b
    where coalesce(b->>'kind','teach') <> 'teach'
      or (b->>'startWeek')::date > (b->>'endWeek')::date
      or (b->>'endWeek')::date >= date_trunc('week', _saved.exam_date::timestamp)::date
      or extract(isodow from (b->>'startWeek')::date) <> 1
      or extract(isodow from (b->>'endWeek')::date) <> 1
      or (b->>'weeks')::int <> ((b->>'endWeek')::date - (b->>'startWeek')::date) / 7 + 1
      or b->>'fixedPoints' is distinct from 'true'
      or b->'schedule'->>'from' is distinct from _from::text
      or b->'schedule'->>'examDate' is distinct from _saved.exam_date::text
      or jsonb_typeof(b->'pointsByWeek') is distinct from 'object') then
    raise exception 'Invalid calendar allocation.';
  end if;
  -- A weekly slot belongs to one teaching topic, and every point stays on this course.
  if exists (select d from jsonb_array_elements(_pacing) b,
      lateral generate_series((b->>'startWeek')::date, (b->>'endWeek')::date, interval '7 days') d
      group by d having count(*) > 1) then raise exception 'Teaching weeks overlap.'; end if;
  if exists (select 1 from jsonb_array_elements(_pacing) b,
      lateral jsonb_each(b->'pointsByWeek') w,
      lateral jsonb_array_elements(w.value) p
      left join spec_points sp on sp.id::text = p->>'specPointId'
      left join topics t on t.id = sp.topic_id
    where sp.id is null or t.id::text <> b->>'topicId'
      or t.subject <> _subject or t.board <> _board or t.level <> _level
      or w.key::date < (b->>'startWeek')::date or w.key::date > (b->>'endWeek')::date
      or extract(isodow from w.key::date) <> 1) then
    raise exception 'A point is outside its topic or teaching dates.';
  end if;
  select count(*) into _count from jsonb_array_elements(_pacing) b,
    lateral jsonb_each(b->'pointsByWeek') w, lateral jsonb_array_elements(w.value) p;
  if _count <> (select count(distinct p->>'specPointId') from jsonb_array_elements(_pacing) b,
    lateral jsonb_each(b->'pointsByWeek') w, lateral jsonb_array_elements(w.value) p)
    or _count <> (select count(*) from spec_points sp join topics t on t.id = sp.topic_id
      where t.subject = _subject and t.board = _board and t.level = _level) then
    raise exception 'Every course point must appear exactly once. Reload if the curriculum changed.';
  end if;
  -- Earlier topic bands cannot move. Previously frozen weekly point allocations
  -- also compare exactly, so a second reorder cannot rewrite the first one's history.
  if exists (select 1 from jsonb_array_elements(_saved.pacing) old
    where coalesce(old->>'kind','teach')='teach' and (old->>'startWeek')::date < _from and not exists (
      select 1 from jsonb_array_elements(_pacing) b
      where b->>'topicId' = old->>'topicId' and b->>'startWeek' = old->>'startWeek'
        and (b->>'endWeek')::date = least((old->>'endWeek')::date, _from - 7)
        and (old->>'fixedPoints' is distinct from 'true' or not exists (
          select 1 from jsonb_each(old->'pointsByWeek') w where w.key::date < _from
            and b->'pointsByWeek'->w.key is distinct from w.value)))) then
    raise exception 'Earlier weeks must stay unchanged.';
  end if;

  -- Lock affected saved weeks before taking the preservation snapshot. A student
  -- can start future work early: protection is deliberately not week-scoped here.
  perform id from student_weekly_plans where student_id = _student and subject = _subject
    and week_start >= _from order by week_start for update;
  select coalesce(jsonb_agg(jsonb_build_object('plan_id', wp.id, 'spec_point_id', pp.spec_point_id,
      'topic_id', sp.topic_id, 'week', wp.week_start, 'origin', pp.origin)), '[]'::jsonb)
    into _protected from student_weekly_plans wp
    join student_weekly_plan_points pp on pp.plan_id = wp.id
    join spec_points sp on sp.id = pp.spec_point_id
    where wp.student_id = _student and wp.subject = _subject and wp.week_start >= _from
      and (pp.done_at is not null or pp.carried_from is not null or pp.origin in ('student','tutor')
        or exists (select 1 from homework_submissions h join resources r on r.id = h.resource_id
          where h.student_id = _student and r.kind = 'homework'
            and (r.spec_point_id = pp.spec_point_id or exists (
              select 1 from resource_spec_points l where l.resource_id = r.id and l.spec_point_id = pp.spec_point_id)))
        or exists (select 1 from mcq_attempts a where a.user_id = _student
          and (a.point_scores ? pp.spec_point_id::text or exists (
            select 1 from mcq_sets m where m.id = a.set_id and m.spec_point_id = pp.spec_point_id)
            or exists (select 1 from mcq_questions q where q.set_id = a.set_id and q.spec_point_id = pp.spec_point_id))));
  -- Preserve admission of work already started, even if its remaining topic now
  -- begins later. This records that teaching has already reached this topic.
  select jsonb_agg(case when exists (select 1 from jsonb_array_elements(_protected) p where p->>'topic_id' = b->>'topicId' and (p->>'week')::date < least((b->>'openedWeek')::date, (b->>'startWeek')::date))
      then jsonb_set(b, '{openedWeek}', to_jsonb(least((b->>'openedWeek')::date,
        (select min((p->>'week')::date) from jsonb_array_elements(_protected) p where p->>'topic_id' = b->>'topicId'))::text))
      else b end order by ord) into _pacing from jsonb_array_elements(_pacing) with ordinality as items(b, ord);

  update student_program_plan set pacing = _pacing, acknowledged_at = now(), updated_at = now()
    where student_id = _student and subject = _subject;
  for _week in select * from student_weekly_plans
    where student_id = _student and subject = _subject and week_start >= _from
      and week_start < _saved.exam_date order by week_start for update
  loop
    -- Retain assessed reviews and previously promised catch-up. The existing
    -- save function separately protects manual, completed, carried and attempted work.
    with desired as (
      select (p->>'specPointId')::uuid as id, 'core'::plan_point_origin as origin from jsonb_array_elements(_pacing) b,
        lateral jsonb_array_elements(coalesce(b->'pointsByWeek'->_week.week_start::text, '[]'::jsonb)) p
        where not ((p->>'specPointId')::uuid = any(_assessed))
          and not exists (select 1 from student_weekly_plan_points done join student_weekly_plans wp on wp.id=done.plan_id
            where wp.student_id=_student and done.spec_point_id=(p->>'specPointId')::uuid and done.done_at is not null)
      union
      select (p->>'specPointId')::uuid, 'focus'::plan_point_origin from jsonb_array_elements(_reviews) b,
        lateral jsonb_array_elements(b->'points') p
        where b->>'startWeek' = _week.week_start::text and (p->>'specPointId')::uuid = any(_assessed)
      union
      select (p->>'spec_point_id')::uuid, (p->>'origin')::plan_point_origin
        from jsonb_array_elements(_protected) p where p->>'plan_id' = _week.id::text
      union
      select pp.spec_point_id, pp.origin from student_weekly_plan_points pp where pp.plan_id = _week.id
        and ((pp.origin = 'focus' and _week.week_start = date_trunc('week', now() at time zone 'Europe/London')::date) or (pp.origin <> 'focus' and exists (
          select 1 from jsonb_array_elements(_pacing) b, lateral jsonb_each(b->'pointsByWeek') w,
            lateral jsonb_array_elements(w.value) p
          where w.key::date < _from and p->>'specPointId' = pp.spec_point_id::text)))
    )
    select coalesce(jsonb_agg(jsonb_build_object('spec_point_id', d.id,
      'origin', case when exists (select 1 from jsonb_array_elements(_protected) p where p->>'plan_id' = _week.id::text and p->>'spec_point_id' = d.id::text) then pp.origin else d.origin end, 'carried_from', pp.carried_from)), '[]'::jsonb)
      into _points from (select id, case when bool_or(origin = 'focus') then 'focus'::plan_point_origin else min(origin::text)::plan_point_origin end as origin from desired group by id) d
        left join student_weekly_plan_points pp on pp.plan_id = _week.id and pp.spec_point_id = d.id;
    perform save_weekly_plan(_student, _subject, _board, _level, _week.week_start,
      _week.source, 'Updated to the chosen topic order. Reviews retain their assessed timing.', _points);
  end loop;
end $$;
revoke all on function public.reorder_student_topics(subject, board, level, date, jsonb, date, jsonb, uuid[], jsonb, uuid) from public, anon;
grant execute on function public.reorder_student_topics(subject, board, level, date, jsonb, date, jsonb, uuid[], jsonb, uuid) to authenticated;

-- ── 7 · Version ───────────────────────────────────────────────────────────

-- 5: overrides exist. The client shows the tutor's override controls only at
-- this version or later, and refuses to save a week below 4 as before.
create or replace function public.assessment_scheduler_version()
returns integer language sql stable security invoker set search_path = public
as $$ select 5 $$;
revoke all on function public.assessment_scheduler_version() from public, anon;
grant execute on function public.assessment_scheduler_version() to authenticated;

notify pgrst, 'reload schema';

commit;
