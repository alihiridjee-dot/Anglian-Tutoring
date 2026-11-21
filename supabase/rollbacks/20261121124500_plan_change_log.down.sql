-- Rollback for 20261121124500_plan_change_log.sql: changes to a student's plan
-- are no longer logged, and the log is dropped with every row in it. The
-- tutor's Changes tab then pieces changes together from the rows they left
-- behind, as it did before. Idempotent.

drop trigger if exists break_logged on public.student_breaks;
drop trigger if exists program_plan_logged on public.student_program_plan;
drop trigger if exists plan_point_logged_update on public.student_weekly_plan_points;
drop trigger if exists plan_point_logged_insert on public.student_weekly_plan_points;
drop trigger if exists plan_override_logged on public.student_plan_overrides;

drop function if exists private.log_break();
drop function if exists private.log_program_plan();
drop function if exists private.plan_topic_order(jsonb);
drop function if exists private.log_plan_point();
drop function if exists private.log_plan_override();
drop function if exists private.log_plan_change(uuid, public.subject, text, uuid, date, jsonb);

drop table if exists public.student_plan_changes;
