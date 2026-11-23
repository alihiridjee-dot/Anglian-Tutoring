-- Two checks on the plan tables, where a rule is cheapest to hold.
--
-- 1. A saved week starts on a Monday. Every week the planner saves starts on
--    one, but the table never held a row to it: on 22 Nov 2026
--    save_weekly_plan accepted a week starting Wednesday 8 Jul 2026, before
--    the programme had even begun (audit N5; the scratch row was deleted at
--    once).
-- 2. A programme's pacing is a list. A student can write this column
--    directly, and a pacing of {} makes enforce_plan_point_admissible raise on
--    every automatic insert, so none of their weeks could be built.
--
-- Checked read-only on the live project on 22 Nov 2026: 0 of 60 weekly plans
-- start on another day, 0 of 17 programmes hold anything but a list, and
-- pacing is never null. So both checks are added and validated in one step.
--
-- Nothing else changes. Idempotent.
--
-- Rollback: supabase/rollbacks/20261123120000_plan_table_checks.down.sql

alter table public.student_weekly_plans
  drop constraint if exists student_weekly_plans_week_start_monday,
  add constraint student_weekly_plans_week_start_monday
    check (extract(isodow from week_start) = 1);

alter table public.student_program_plan
  drop constraint if exists student_program_plan_pacing_is_list,
  add constraint student_program_plan_pacing_is_list
    check (jsonb_typeof(pacing) = 'array');
