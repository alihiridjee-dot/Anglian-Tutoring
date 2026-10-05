-- Rollback for 20261005083300_break_pickup.sql. Run by hand.
--
-- Stops recording finished breaks and puts end_break back as 20261004114000
-- left it. Recorded break stops are deleted, because the reason rule without
-- 'break' can't hold them. A programme already picked up after a break keeps
-- its new calendar: only the record of the stop goes.

select cron.unschedule('record-finished-breaks')
 where exists (select 1 from cron.job where jobname = 'record-finished-breaks');

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
  return 'ended_early';
end;
$function$;

drop function if exists private.record_finished_breaks();
drop function if exists private.record_break(uuid);

alter table public.student_breaks drop column if exists recorded_at;

delete from public.student_subject_pauses where reason = 'break';
alter table public.student_subject_pauses drop constraint student_subject_pauses_reason_check;
alter table public.student_subject_pauses add constraint student_subject_pauses_reason_check
  check (reason in ('paused', 'payment', 'cancelled', 'subject_removed', 'not_on_plan'));
