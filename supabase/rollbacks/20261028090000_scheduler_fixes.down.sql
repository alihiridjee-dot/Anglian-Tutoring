-- Rollback for 20261028090000_scheduler_fixes.sql. Run by hand.
--
-- Puts plan_point_tick_state back as 20261007094747 left it (a hand-in counts
-- only inside the plan's own week) and end_break as 20261005161000 left it (a
-- break that began this week is called off on its own), and drops the check
-- on moving an exam date. Ticks earned under the new rule stay until the
-- student's next attempt or hand-in on the point refreshes them.

drop trigger if exists exam_date_clear_of_breaks on public.student_program_plan;
drop function if exists private.exam_date_clear_of_breaks();

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

revoke all on function private.plan_point_tick_state(uuid, uuid, date) from public, anon, authenticated;

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

revoke all on function public.end_break(uuid) from public, anon;
grant execute on function public.end_break(uuid) to authenticated;
