-- Rollback for 20261123120000_plan_table_checks: the two checks go. No rows
-- change. Idempotent.

alter table public.student_weekly_plans
  drop constraint if exists student_weekly_plans_week_start_monday;

alter table public.student_program_plan
  drop constraint if exists student_program_plan_pacing_is_list;
