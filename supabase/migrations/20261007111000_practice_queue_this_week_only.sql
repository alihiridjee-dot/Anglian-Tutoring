-- Quizzes and tasks are queued only for what a student is shown this week.
--
-- Ali's rule (7 Oct 2026): the practice queue writes a quiz or a task only for
-- a point on someone's plan for the current week. A point from an old week is
-- written once it is cut into this week again, never before.
--
-- What went wrong. plan_point_enqueues_practice queued a point whenever a row
-- of any week was written, whatever the week. At 09:47 on 7 Oct,
-- 20261007094747 re-checked the tick on every row of every week ever saved,
-- and the test student's 14 old weeks (July to September, planned before the
-- queue existed) sent 45 points with no quiz or task into the queue at once:
-- 90 jobs, 47 of them written before the daily cap held the rest. Each later
-- tick refresh (refresh_plan_ticks, after a quiz attempt or a hand-in) writes
-- the student's rows in every week too.
--
-- Now the trigger asks for the row's week first, and only the current week
-- queues: Monday to Sunday in London, as the planner counts it. In the last
-- hour of Sunday next week counts too. A device clock a little fast cuts the
-- new week before the database's clock has turned, and nothing else would
-- write those rows again that week.
--
-- The jobs still waiting that this rule would never have queued are removed:
-- pending, not asked for with a tutor's button, for a point on no plan this
-- week. Their runs keep their history (exam_generation_runs.job_id is set
-- null). A point that comes back into a week this week is queued afresh.
--
-- Not changed: a tutor's "generate" button (request_practice_job) and the
-- retry script (rearm_failed_practice_jobs) are deliberate, and go on working
-- for any point.
--
-- Idempotent. Rollback: supabase/rollbacks/20261007111000_practice_queue_this_week_only.down.sql

create or replace function private.enqueue_practice_for_plan_point()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  begin
    if exists (
      select 1 from public.student_weekly_plans w
      where w.id = new.plan_id
        and w.week_start in (
          date_trunc('week', now() at time zone 'Europe/London')::date,
          date_trunc('week', (now() + interval '1 hour') at time zone 'Europe/London')::date)
    ) then
      perform private.enqueue_practice(new.spec_point_id);
    end if;
  exception when others then
    raise warning 'practice queue: could not enqueue %: %', new.spec_point_id, sqlerrm;
  end;
  return null;
end;
$function$;

revoke all on function private.enqueue_practice_for_plan_point() from public, anon, authenticated;

delete from private.practice_jobs j
where j.status = 'pending'
  and not j.requested
  and not exists (
    select 1
    from public.student_weekly_plan_points pp
    join public.student_weekly_plans w on w.id = pp.plan_id
    where pp.spec_point_id = j.spec_point_id
      and w.week_start in (
        date_trunc('week', now() at time zone 'Europe/London')::date,
        date_trunc('week', (now() + interval '1 hour') at time zone 'Europe/London')::date));
