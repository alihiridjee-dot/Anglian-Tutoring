-- Rollback for 20261005220000_practice_queue.sql. Run by hand, and only once
-- the site is back on code that writes quizzes and tasks itself (through
-- ensure_generated_mcq_set and ensure_generated_homework, which the migration
-- never changed). With this gone and the new code still live, nothing writes
-- them at all.
--
-- Stops the minute job and the trigger, and drops the queue: its jobs, its
-- settings and its functions. The quizzes and tasks it wrote stay, as library
-- content like any other.
--
-- exam_generation_runs keeps every row. The columns the migration added go
-- (outcome, error, stop_reason, raw_output, source, job_id, duration_ms), so
-- export them first if they will be wanted. A failed call's row stays too,
-- with an empty question list and empty usage in place of none, so both
-- columns can be required again as they were.
--
-- Safe to run twice.

select cron.unschedule('practice-worker')
 where exists (select 1 from cron.job where jobname = 'practice-worker');

drop trigger if exists plan_point_enqueues_practice on public.student_weekly_plan_points;

drop function if exists public.request_practice_job(uuid, text, boolean);
drop function if exists public.claim_practice_jobs(integer, uuid, text);
drop function if exists public.complete_practice_job(bigint, uuid, jsonb, uuid);
drop function if exists public.fail_practice_job(bigint, uuid, text, text, integer);
drop function if exists public.practice_queue_status();
drop function if exists public.pause_practice_queue(integer, text);
drop function if exists public.rearm_failed_practice_jobs(uuid[]);
drop function if exists private.kick_practice_worker();
drop function if exists private.enqueue_practice_for_plan_point();
drop function if exists private.enqueue_practice(uuid, text);
drop function if exists private.save_generated_quiz(uuid, jsonb);
drop function if exists private.save_generated_task(uuid, jsonb);
drop function if exists private.practice_content_id(uuid, text, boolean);

drop index if exists public.exam_generation_runs_job_id_idx;
drop index if exists public.exam_generation_runs_created_at_idx;

alter table public.exam_generation_runs
  drop constraint if exists exam_generation_runs_failure_says_why,
  drop constraint if exists exam_generation_runs_questions_unless_failed,
  drop column if exists outcome,
  drop column if exists error,
  drop column if exists stop_reason,
  drop column if exists raw_output,
  drop column if exists source,
  drop column if exists job_id,
  drop column if exists duration_ms;

update public.exam_generation_runs
   set generated_questions = coalesce(generated_questions, '[]'::jsonb),
       usage = coalesce(usage, '{}'::jsonb)
 where generated_questions is null or usage is null;

alter table public.exam_generation_runs
  alter column generated_questions set not null,
  alter column usage set not null;

drop table if exists private.practice_queue;
drop table if exists private.practice_jobs;
