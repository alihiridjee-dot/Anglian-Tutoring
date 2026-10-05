-- Breaks, picked up once they're over (PR 2 of the break work).
--
-- While a break is booked or under way, the planner shows the course as it
-- will be picked up: no teaching in the break weeks, and what they would have
-- held spread from the week the student comes back to the exam. It works that
-- out on every load (resumeAfterPause, src/lib/planner/topicOrder.ts) and
-- saves nothing, so a break called off leaves no mark.
--
-- Once a break is over, or cut short by coming back early, it is recorded
-- here as a finished stop of every subject the student has a programme for,
-- with the reason 'break'. From then on it is picked up exactly as a billing
-- pause is (20261004091000): the planner saves the same calendar it was
-- already showing through resume_programme_after_pause, checked the same way,
-- and review clocks skip the time.
--
-- A recorded break is a closed stop. It never holds a subject paused now, so
-- sync_subject_pauses, which only touches open stops, and the hard stop on
-- planning leave it alone.

alter table public.student_subject_pauses drop constraint student_subject_pauses_reason_check;
alter table public.student_subject_pauses add constraint student_subject_pauses_reason_check
  check (reason in (
    'paused',          -- the family paused the plan
    'payment',         -- a payment failed, or the plan ended without the family cancelling it
    'cancelled',       -- the family cancelled the plan, and it has ended
    'subject_removed', -- the family removed this subject from the plan
    'not_on_plan',     -- enrolled, but the plan doesn't cover this many subjects
    'break'            -- a break the student, a parent or a tutor booked (student_breaks), once over
  ));

alter table public.student_breaks add column recorded_at timestamptz;

comment on column public.student_breaks.recorded_at is
  'When the finished break was recorded as a stop of each subject with a programme (student_subject_pauses, reason break).';

-- Record one finished break as a stop of each subject with a programme. Does
-- nothing for a break called off or already recorded.
create or replace function private.record_break(p_break_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _b public.student_breaks%rowtype;
begin
  select * into _b from public.student_breaks where id = p_break_id for update;
  if not found or _b.cancelled_at is not null or _b.recorded_at is not null then
    return;
  end if;

  -- UK midnight on the Monday it began, to UK midnight on the Monday after it
  -- ended: the planner reads both back as those two weeks.
  insert into public.student_subject_pauses (student_id, subject, reason, started_at, ended_at)
  select _b.student_id, pp.subject, 'break',
         _b.starts_on::timestamp at time zone 'Europe/London',
         (_b.ends_on + 1)::timestamp at time zone 'Europe/London'
  from public.student_program_plan pp
  where pp.student_id = _b.student_id;

  update public.student_breaks set recorded_at = now() where id = p_break_id;
end;
$function$;

revoke all on function private.record_break(uuid) from public, anon, authenticated;

-- Every break that ended before this week and isn't recorded yet. Returns how
-- many it recorded.
create or replace function private.record_finished_breaks()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _this_week date := date_trunc('week', now() at time zone 'Europe/London')::date;
  _id uuid;
  _recorded integer := 0;
begin
  for _id in
    select b.id from public.student_breaks b
    where b.cancelled_at is null and b.recorded_at is null and b.ends_on < _this_week
    order by b.starts_on
  loop
    perform private.record_break(_id);
    _recorded := _recorded + 1;
  end loop;
  return _recorded;
end;
$function$;

revoke all on function private.record_finished_breaks() from public, anon, authenticated;

-- end_break as 20261005160000 left it, with one change: a break cut short is
-- over now, so it is recorded at once rather than at the next hourly run.
create or replace function public.end_break(_break_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _caller uuid := (select auth.uid());
  _this_week date := date_trunc('week', now() at time zone 'Europe/London')::date;
  _b public.student_breaks%rowtype;
  _next date;
begin
  select * into _b from public.student_breaks where id = _break_id for update;
  if not found or _b.cancelled_at is not null then
    raise exception 'That break no longer exists.' using errcode = 'P0002';
  end if;
  if not private.may_manage_breaks(_b.student_id) then
    raise exception 'Only the student, their parent or a tutor can change a break.'
      using errcode = '42501';
  end if;
  if _b.ends_on < _this_week then
    raise exception 'That break is already over.' using errcode = '22023';
  end if;

  if _b.starts_on >= _this_week then
    update public.student_breaks
       set cancelled_at = now(), ended_by = _caller
     where id = _break_id;
    return 'cancelled';
  end if;

  update public.student_breaks
     set ends_on = _this_week - 1, ended_early_at = now(), ended_by = _caller
   where id = _break_id;
  -- Back means back: a break booked to run on from this one goes too.
  _next := _b.ends_on + 1;
  loop
    update public.student_breaks b
       set cancelled_at = now(), ended_by = _caller
     where b.student_id = _b.student_id and b.cancelled_at is null and b.starts_on = _next
    returning b.ends_on + 1 into _next;
    exit when not found;
  end loop;
  perform private.record_break(_break_id);
  return 'ended_early';
end;
$function$;

-- The backstop for a break that simply runs out: every hour.
select cron.unschedule('record-finished-breaks')
 where exists (select 1 from cron.job where jobname = 'record-finished-breaks');

select cron.schedule(
  'record-finished-breaks',
  '10 * * * *',
  $cron$ select private.record_finished_breaks(); $cron$
);
