-- Rollback for 20261007130000_plan_heal: no nightly plan check. Weeks are
-- still put right when their student looks (useWeekPlan). The record of past
-- runs goes with the table.
select cron.unschedule('plan-heal')
 where exists (select 1 from cron.job where jobname = 'plan-heal');

drop function if exists private.kick_plan_heal(boolean);
drop function if exists public.record_plan_heal_run(date, boolean, jsonb);
drop table if exists private.plan_heal_runs;
