-- The weekly task list's tick is earned, not claimed.
--
-- Until now a student ticked a spec point off their week by hand
-- (20260904120000), and nothing checked it. A tick also matters: a ticked point
-- is kept through every re-cut, the tutor can no longer remove or skip it, and
-- the spine never plans it as core work again. So a careless tick quietly
-- dropped a point from the student's programme.
--
-- From here the database sets the tick. A point is done in a week when every
-- kind of practice the student can see on it was attempted in that week
-- (Europe/London Monday to Sunday, the same window plan_point_has_work uses):
--
--   quiz   a published MCQ set on the point             -> a counted attempt on it
--   task   a homework the student can see on the point  -> a hand-in on it
--
-- A point with both needs both. "Can see" mirrors the resources read rule: an
-- approved task, or one awaiting review whose publish time has passed.
--
-- A point with neither keeps the student's own tick for now. On 5 Oct that was
-- 3,768 of 3,788 points, and removing the box from all of them would leave the
-- list with nothing to tick. Each point moves to the earned rule as soon as
-- practice is attached to it.
--
-- How it is enforced:
--   * A BEFORE trigger on student_weekly_plan_points overwrites done_at with
--     the earned value on every insert, and on any update that names done_at,
--     plan_id or spec_point_id. Whatever the client sends is ignored, so no
--     policy or grant needs to change.
--   * AFTER triggers on mcq_attempts and homework_submissions refresh the
--     student's plan rows for the points that work touches, so the box fills
--     the moment a quiz is scored or a task handed in.
--   * Work removed later (deletes) is not re-read; nothing a student does
--     deletes an attempt or a hand-in.
--
-- Finally every existing plan row is re-evaluated: hand ticks on points that
-- have practice are replaced by what the work says.

create or replace function private.plan_point_tick_state(
  _student_id uuid, _spec_point_id uuid, _week_start date)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _from timestamptz := _week_start::timestamp at time zone 'Europe/London';
  _to   timestamptz := (_week_start + 7)::timestamp at time zone 'Europe/London';
  _quiz boolean;
  _task boolean;
begin
  _quiz := exists (
    select 1 from mcq_sets m
    where m.published
      and (m.spec_point_id = _spec_point_id or exists (
        select 1 from mcq_questions q where q.set_id = m.id and q.spec_point_id = _spec_point_id)));

  _task := exists (
    select 1 from resources r
    where r.kind = 'homework'
      and (r.review_status = 'approved'
        or (r.review_status = 'to_review' and (r.publish_at is null or r.publish_at <= now())))
      and (r.spec_point_id = _spec_point_id or exists (
        select 1 from resource_spec_points l
        where l.resource_id = r.id and l.spec_point_id = _spec_point_id)));

  if not _quiz and not _task then
    return 'none';
  end if;

  if _quiz and not exists (
    select 1 from mcq_attempts a
    where a.user_id = _student_id
      and a.created_at >= _from and a.created_at < _to
      and (a.point_scores ? _spec_point_id::text
        or exists (select 1 from mcq_sets m where m.id = a.set_id and m.spec_point_id = _spec_point_id)
        or exists (select 1 from mcq_questions q where q.set_id = a.set_id and q.spec_point_id = _spec_point_id))
  ) then
    return 'open';
  end if;

  if _task and not exists (
    select 1 from homework_submissions h
    join resources r on r.id = h.resource_id
    where h.student_id = _student_id and r.kind = 'homework'
      and h.submitted_at >= _from and h.submitted_at < _to
      and (r.spec_point_id = _spec_point_id or exists (
        select 1 from resource_spec_points l
        where l.resource_id = r.id and l.spec_point_id = _spec_point_id))
  ) then
    return 'open';
  end if;

  return 'done';
end;
$$;

create or replace function private.plan_point_tick_from_work()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _student uuid;
  _week date;
  _state text;
begin
  select student_id, week_start into _student, _week
  from student_weekly_plans where id = new.plan_id;
  if _student is null then
    return new;
  end if;

  _state := private.plan_point_tick_state(_student, new.spec_point_id, _week);
  if _state = 'none' then
    return new; -- no practice on this point yet: the student's own tick stands
  elsif _state = 'done' then
    -- Keep the first time it was earned; a refresh must not move the date.
    new.done_at := coalesce(case when tg_op = 'UPDATE' then old.done_at end, now());
  else
    new.done_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists plan_point_tick_from_work on public.student_weekly_plan_points;
create trigger plan_point_tick_from_work
  before insert or update of done_at, plan_id, spec_point_id on public.student_weekly_plan_points
  for each row execute function private.plan_point_tick_from_work();

-- Re-evaluate one student's plan rows for the given points.
create or replace function private.refresh_plan_ticks(_student_id uuid, _spec_point_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update student_weekly_plan_points pp
  set done_at = pp.done_at -- names done_at, so the BEFORE trigger recomputes it
  from student_weekly_plans wp
  where wp.id = pp.plan_id
    and wp.student_id = _student_id
    and pp.spec_point_id = any(_spec_point_ids);
$$;

create or replace function private.plan_ticks_after_attempt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.refresh_plan_ticks(new.user_id, array(
    select m.spec_point_id from mcq_sets m where m.id = new.set_id and m.spec_point_id is not null
    union
    select q.spec_point_id from mcq_questions q where q.set_id = new.set_id and q.spec_point_id is not null
    union
    select k::uuid from jsonb_object_keys(
      case when jsonb_typeof(new.point_scores) = 'object' then new.point_scores else '{}'::jsonb end) k
    where k ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
  return null;
end;
$$;

drop trigger if exists plan_ticks_after_attempt on public.mcq_attempts;
create trigger plan_ticks_after_attempt
  after insert or update of created_at, point_scores on public.mcq_attempts
  for each row execute function private.plan_ticks_after_attempt();

create or replace function private.plan_ticks_after_hand_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.refresh_plan_ticks(new.student_id, array(
    select r.spec_point_id from resources r
    where r.id = new.resource_id and r.kind = 'homework' and r.spec_point_id is not null
    union
    select l.spec_point_id from resource_spec_points l
    join resources r on r.id = l.resource_id
    where l.resource_id = new.resource_id and r.kind = 'homework'));
  return null;
end;
$$;

drop trigger if exists plan_ticks_after_hand_in on public.homework_submissions;
create trigger plan_ticks_after_hand_in
  after insert or update of submitted_at on public.homework_submissions
  for each row execute function private.plan_ticks_after_hand_in();

revoke all on function private.plan_point_tick_state(uuid, uuid, date) from public, anon, authenticated;
revoke all on function private.plan_point_tick_from_work() from public, anon, authenticated;
revoke all on function private.refresh_plan_ticks(uuid, uuid[]) from public, anon, authenticated;
revoke all on function private.plan_ticks_after_attempt() from public, anon, authenticated;
revoke all on function private.plan_ticks_after_hand_in() from public, anon, authenticated;

-- Keep the hand ticks as they stood, so the rollback can put them back. Made
-- once: running this file again must not overwrite it with earned ticks.
create table if not exists private.plan_ticks_before_20261007120000 as
  select plan_id, spec_point_id, done_at
  from public.student_weekly_plan_points where done_at is not null;
revoke all on private.plan_ticks_before_20261007120000 from public, anon, authenticated;

-- Re-evaluate every existing row. Only rows whose point has practice change.
-- `where true`: pg-safeupdate refuses an UPDATE with no WHERE clause.
update public.student_weekly_plan_points set done_at = done_at where true;
