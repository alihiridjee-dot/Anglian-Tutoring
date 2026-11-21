-- A log of the changes made to a student's plan.
--
-- Ali asked to see what has been changed in a student's plan over time (21 Nov
-- 2026). Until now nothing recorded it: the tutor's Changes tab read back what
-- each change left behind, so a change that was later undone, a new topic
-- order and a new exam date left nothing to show, and nothing said which tutor
-- added a point.
--
-- student_plan_changes holds one row per change, written by the database as
-- the change is made, so no screen, script or nightly job can make a change
-- that goes unrecorded:
--
--   student_plan_overrides        a point removed from a week, moved to another
--                                 (the planner's "Moved to the week of …"
--                                 note), or skipped for good; and each of those
--                                 undone (the row deleted)
--   student_weekly_plan_points    a point put into a week by hand (origin tutor
--                                 or student), or carried forward into one
--   student_program_plan          the plan started; the exam date changed; the
--                                 order the topics are taught in changed
--   student_breaks                a break booked, cancelled, or ended early
--
-- Each row says who did it (auth.uid() at the time) and as what: the student,
-- a tutor, or the system (a nightly job, which has no user). The programme's
-- own weekly cut is not a change anyone made and is not logged.
--
-- The log is read by tutors and admins only, and written by nobody directly:
-- the triggers' functions are security definer, and clients have no write
-- grant. It goes with the student's account (on delete cascade).
--
-- A log must never stop the change it records. Every trigger function catches
-- its own failure and raises a warning instead, and writes nothing while the
-- student's account is being deleted.
--
-- Nothing is backfilled: the log starts the day this is applied. The Changes
-- tab still pieces older changes together from the rows they left behind.
--
-- Idempotent. Rollback: supabase/rollbacks/20261121124500_plan_change_log.down.sql

create table if not exists public.student_plan_changes (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references auth.users(id) on delete cascade,
  -- Null for a change that is not one subject's: a break.
  subject       public.subject,
  kind          text not null check (kind in (
                  'removed', 'moved', 'skipped', 'restored', 'unskipped',
                  'added', 'carried',
                  'plan-started', 'exam-date', 'topic-order',
                  'break-booked', 'break-cancelled', 'break-ended')),
  -- Who did it; null for the system, or once that account is gone.
  actor_id      uuid references auth.users(id) on delete set null,
  actor_role    text not null check (actor_role in ('tutor', 'student', 'system')),
  spec_point_id uuid references public.spec_points(id) on delete set null,
  -- The week the change is about (a Monday); a break's first day.
  week_start    date,
  -- What else the sentence needs: to_week, from_week, from/to dates, the
  -- topics' titles before and after.
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists student_plan_changes_student_idx
  on public.student_plan_changes (student_id, created_at desc);

alter table public.student_plan_changes enable row level security;

revoke all on table public.student_plan_changes from public, anon, authenticated;
grant select on table public.student_plan_changes to authenticated;

drop policy if exists "plan changes staff read" on public.student_plan_changes;
create policy "plan changes staff read" on public.student_plan_changes
  for select to authenticated
  using (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    or private.has_role((select auth.uid()), 'admin'::public.app_role)
  );

-- One row into the log. Never raises: a failed log entry is a warning, not a
-- failed change.
create or replace function private.log_plan_change(
  _student uuid,
  _subject public.subject,
  _kind text,
  _spec_point uuid,
  _week date,
  _detail jsonb
) returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _actor uuid := (select auth.uid());
  _role text;
begin
  -- The account is being deleted: its rows are going, and so is its log.
  if not exists (select 1 from auth.users u where u.id = _student) then
    return;
  end if;
  _role := case
    when _actor is null then 'system'
    when _actor = _student then 'student'
    when private.has_role(_actor, 'tutor'::public.app_role)
      or private.has_role(_actor, 'admin'::public.app_role) then 'tutor'
    else 'system'
  end;
  insert into public.student_plan_changes
    (student_id, subject, kind, actor_id, actor_role, spec_point_id, week_start, detail)
  values
    (_student, _subject, _kind, _actor, _role, _spec_point, _week, coalesce(_detail, '{}'::jsonb));
exception when others then
  raise warning 'plan change not logged (%): %', _kind, sqlerrm;
end
$function$;

revoke all on function private.log_plan_change(uuid, public.subject, text, uuid, date, jsonb)
  from public, anon, authenticated;

-- A point set aside by a tutor, and set back.
create or replace function private.log_plan_override()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _to text;
begin
  if tg_op = 'INSERT' then
    if new.kind = 'skip' then
      perform private.log_plan_change(new.student_id, new.subject, 'skipped',
        new.spec_point_id, null, '{}'::jsonb);
    else
      _to := substring(coalesce(new.note, '') from '^Moved to the week of (\d{4}-\d{2}-\d{2})$');
      perform private.log_plan_change(new.student_id, new.subject,
        case when _to is null then 'removed' else 'moved' end,
        new.spec_point_id, new.week_start,
        case when _to is null then '{}'::jsonb else jsonb_build_object('to_week', _to) end);
    end if;
    return new;
  end if;
  -- A point that has left the course takes its overrides with it: not an undo.
  if exists (select 1 from public.spec_points sp where sp.id = old.spec_point_id) then
    perform private.log_plan_change(old.student_id, old.subject,
      case when old.kind = 'skip' then 'unskipped' else 'restored' end,
      old.spec_point_id, old.week_start, '{}'::jsonb);
  end if;
  return old;
end
$function$;

drop trigger if exists plan_override_logged on public.student_plan_overrides;
create trigger plan_override_logged
  after insert or delete on public.student_plan_overrides
  for each row execute function private.log_plan_override();

-- A point put into a week by hand, or carried forward into one. The
-- programme's own lines (and a re-save of a line already there, which is an
-- update that changes neither column) are not changes anyone made.
create or replace function private.log_plan_point()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _plan public.student_weekly_plans%rowtype;
  _by_hand boolean := new.origin::text in ('tutor', 'student');
  _was_by_hand boolean := false;
  _was_carried boolean := false;
begin
  if tg_op = 'UPDATE' then
    _was_by_hand := old.origin::text in ('tutor', 'student');
    _was_carried := old.carried_from is not null;
  end if;
  if not ((new.carried_from is not null and not _was_carried) or (_by_hand and not _was_by_hand)) then
    return new;
  end if;
  select * into _plan from public.student_weekly_plans p where p.id = new.plan_id;
  if not found then
    return new;
  end if;
  if new.carried_from is not null and not _was_carried then
    perform private.log_plan_change(_plan.student_id, _plan.subject, 'carried',
      new.spec_point_id, _plan.week_start, jsonb_build_object('from_week', new.carried_from));
  else
    perform private.log_plan_change(_plan.student_id, _plan.subject, 'added',
      new.spec_point_id, _plan.week_start, jsonb_build_object('origin', new.origin::text));
  end if;
  return new;
end
$function$;

drop trigger if exists plan_point_logged_insert on public.student_weekly_plan_points;
create trigger plan_point_logged_insert
  after insert on public.student_weekly_plan_points
  for each row
  when (new.carried_from is not null or new.origin::text in ('tutor', 'student'))
  execute function private.log_plan_point();

drop trigger if exists plan_point_logged_update on public.student_weekly_plan_points;
create trigger plan_point_logged_update
  after update of origin, carried_from on public.student_weekly_plan_points
  for each row
  when (old.origin is distinct from new.origin or old.carried_from is distinct from new.carried_from)
  execute function private.log_plan_point();

-- The topics of a plan in the order they are taught: each teaching band's
-- topic, by the first week it is taught in.
create or replace function private.plan_topic_order(_pacing jsonb)
 returns jsonb
 language sql
 immutable
 set search_path to ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title) order by t.first_week, t.id), '[]'::jsonb)
  from (
    select b->>'topicId' as id, min(b->>'title') as title, min(b->>'startWeek') as first_week
    from jsonb_array_elements(case when jsonb_typeof(_pacing) = 'array' then _pacing else '[]'::jsonb end) b
    where coalesce(b->>'kind', 'teach') = 'teach' and b->>'topicId' is not null
    group by 1
  ) t
$function$;

-- The plan started, its exam date changed, or its topics were put in another order.
create or replace function private.log_program_plan()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _before jsonb;
  _after jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.log_plan_change(new.student_id, new.subject, 'plan-started', null,
      new.program_start, jsonb_build_object('exam_date', new.exam_date));
    return new;
  end if;
  if new.exam_date is distinct from old.exam_date then
    perform private.log_plan_change(new.student_id, new.subject, 'exam-date', null, null,
      jsonb_build_object('from', old.exam_date, 'to', new.exam_date));
  end if;
  if new.pacing is distinct from old.pacing then
    _before := private.plan_topic_order(old.pacing);
    _after := private.plan_topic_order(new.pacing);
    -- The same topics in the same order is a change of dates, not of order.
    if (select jsonb_agg(e->>'id') from jsonb_array_elements(_before) e)
       is distinct from (select jsonb_agg(e->>'id') from jsonb_array_elements(_after) e) then
      perform private.log_plan_change(new.student_id, new.subject, 'topic-order', null, null,
        jsonb_build_object(
          'before', (select coalesce(jsonb_agg(e->>'title'), '[]'::jsonb) from jsonb_array_elements(_before) e),
          'after', (select coalesce(jsonb_agg(e->>'title'), '[]'::jsonb) from jsonb_array_elements(_after) e)));
    end if;
  end if;
  return new;
exception when others then
  raise warning 'plan change not logged (programme): %', sqlerrm;
  return new;
end
$function$;

drop trigger if exists program_plan_logged on public.student_program_plan;
create trigger program_plan_logged
  after insert or update of exam_date, pacing on public.student_program_plan
  for each row execute function private.log_program_plan();

-- A break booked, cancelled, or ended early.
create or replace function private.log_break()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    perform private.log_plan_change(new.student_id, null, 'break-booked', null, new.starts_on,
      jsonb_build_object('ends_on', new.ends_on, 'reason', new.reason));
  elsif new.cancelled_at is not null and old.cancelled_at is null then
    perform private.log_plan_change(new.student_id, null, 'break-cancelled', null, new.starts_on,
      jsonb_build_object('ends_on', old.ends_on));
  elsif new.ended_early_at is not null and old.ended_early_at is null then
    perform private.log_plan_change(new.student_id, null, 'break-ended', null, new.starts_on,
      jsonb_build_object('ends_on', new.ends_on));
  end if;
  return new;
end
$function$;

drop trigger if exists break_logged on public.student_breaks;
create trigger break_logged
  after insert or update of cancelled_at, ended_early_at on public.student_breaks
  for each row execute function private.log_break();
