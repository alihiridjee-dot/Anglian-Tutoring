-- Three small fixes to the planner's rules, found in the scheduler audit
-- (27 Oct 2026).
--
-- 1. A task handed in once now counts in every later week of its point.
--    private.plan_point_tick_state (20261007094747) counted a hand-in only if
--    it was made inside the plan's own week. A task can be handed in only once
--    (homework_submissions is unique on resource_id, student_id), so when the
--    same point came back in a later week (a review, carried work, "focus
--    again") its row could never be ticked: the one hand-in was in an earlier
--    week. On 27 Oct two live rows were stuck like that. Now a hand-in made any
--    time before the end of the week counts. A hand-in made after a week has
--    ended still doesn't tick that week. The quiz rule is unchanged: a quiz can
--    be taken again each week, so it still has to be taken inside the week.
--    Rows already saved are not re-checked here; refresh_plan_ticks does that
--    after the student's next attempt or hand-in on the point.
--
-- 2. Calling off a break that began this week calls off the breaks booked to
--    run on from it. public.end_break (20261005161000) cancelled such a break
--    and stopped there, so a break booked straight after it stayed: the student
--    was told "Welcome back" while next week was still a break. Coming back
--    early from an older break already did this ("Back means back"); a break
--    that began this week now does the same. A break still to come is only
--    that one booking being called off, so the breaks after it stay. The
--    function still returns 'cancelled' or 'ended_early'.
--
-- 3. Moving an exam date can't put a break inside the exam window.
--    book_break refuses a break in the 6 weeks before an exam or in the exam
--    week, but nothing checked again when student_program_plan.exam_date moved
--    later, so a date change could land a booked break inside that window. A
--    BEFORE UPDATE trigger now refuses the move while any break that isn't
--    over or called off overlaps the new window, using the same window as
--    book_break: the exam's Monday minus 42 days to that week's Sunday. It
--    runs only when the date really changes, and never on insert: a subject's
--    programme is saved on its first view, and that must never fail. The
--    message is shown to the student as it is.
--
-- Same signatures, security, search_path and grants as before. Idempotent.
--
-- Rollback: supabase/rollbacks/20261028090000_scheduler_fixes.down.sql

-- 1 ── The tick: 20261007094747's body with one line changed, the hand-in's
-- window (was `h.submitted_at >= _from and h.submitted_at < _to`).
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

  -- A task is handed in once, so a hand-in from an earlier week still counts
  -- when the point comes back. One made after this week ended doesn't.
  if _task and not exists (
    select 1 from homework_submissions h
    join resources r on r.id = h.resource_id
    where h.student_id = _student_id and r.kind = 'homework'
      and h.submitted_at < _to
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

-- 2 ── end_break: 20261005161000's body, except that a break which began this
-- week also calls off the breaks booked to run on from it.
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
    -- A break still to come: only this booking is called off.
    if _b.starts_on > _this_week then
      return 'cancelled';
    end if;
    -- One that began this week means the student is back now, so the breaks
    -- booked to run on from it go too (below).
  else
    update public.student_breaks
       set ends_on = _this_week - 1, ended_early_at = now(), ended_by = _caller
     where id = _break_id;
  end if;
  -- Back means back: a break booked to run on from this one goes too.
  _next := _b.ends_on + 1;
  loop
    update public.student_breaks b
       set cancelled_at = now(), ended_by = _caller
     where b.student_id = _b.student_id and b.cancelled_at is null and b.starts_on = _next
    returning b.ends_on + 1 into _next;
    exit when not found;
  end loop;
  if _b.starts_on = _this_week then
    return 'cancelled';
  end if;
  perform private.record_break(_break_id);
  return 'ended_early';
end;
$function$;

revoke all on function public.end_break(uuid) from public, anon;
grant execute on function public.end_break(uuid) to authenticated;

-- 3 ── An exam date can't move so that a booked break falls in the 6 weeks
-- before the exam, or in the exam week. The window is book_break's. A break
-- that is over, or was called off, doesn't count.
create or replace function private.exam_date_clear_of_breaks()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _this_week date := date_trunc('week', now() at time zone 'Europe/London')::date;
  _exam_week date := date_trunc('week', new.exam_date::timestamp)::date;
  _starts_on date;
  _ends_on date;
begin
  select b.starts_on, b.ends_on into _starts_on, _ends_on
  from public.student_breaks b
  where b.student_id = new.student_id
    and b.cancelled_at is null
    and b.ends_on >= _this_week
    and b.starts_on <= _exam_week + 6
    and b.ends_on >= _exam_week - 42
  order by b.starts_on
  limit 1;
  if found then
    raise exception using
      errcode = '23514',
      message = 'You have a break booked from ' || to_char(_starts_on, 'FMDD Mon')
        || ' to ' || to_char(_ends_on, 'FMDD Mon')
        || '. A break can''t fall in the 6 weeks before an exam, so move or call off the break first.',
      hint = 'break_near_exam';
  end if;
  return new;
end;
$function$;

revoke all on function private.exam_date_clear_of_breaks() from public, anon, authenticated;

drop trigger if exists exam_date_clear_of_breaks on public.student_program_plan;
create trigger exam_date_clear_of_breaks
  before update of exam_date on public.student_program_plan
  for each row
  when (old.exam_date is distinct from new.exam_date)
  execute function private.exam_date_clear_of_breaks();
