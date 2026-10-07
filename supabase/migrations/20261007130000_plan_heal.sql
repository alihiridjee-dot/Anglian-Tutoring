-- The nightly plan check: every week saved for this week is checked against
-- its student's full plan, and put right when it has fallen behind.
--
-- Ali, 7 Oct 2026: since #232 a new exam date re-cuts this week, but a week
-- saved before that kept its old points until Monday. His own Biology week
-- listed all of topic 1 while the full plan spread it over three weeks. He
-- asked for a light check that runs on a schedule and heals what it finds.
-- The page-open check (useWeekPlan) heals a week when its student looks; this
-- is the sweep for everyone else.
--
-- The check is the app's own plan code, on Vercel (POST /api/plan-heal, in
-- src/lib/planner/planHeal.server.ts). This migration:
--   1. keeps a record of every run for 90 days (private.plan_heal_runs),
--      written through public.record_plan_heal_run, which only the service
--      role may call;
--   2. adds private.kick_plan_heal(_dry_run), which posts to the route with the
--      secret Vault holds for the practice worker. The route is on the same
--      deployment as the practice worker, so its address is that one's with
--      the last part changed. An address of any other shape sends nothing;
--   3. runs it at 02:30 UTC every night ('plan-heal'), after the hourly break
--      and pause records (:10 and :25) have run.
--
-- A dry run by hand: `select private.kick_plan_heal(true);`, then read the
-- report in net._http_response (the id it returns), or in
-- private.plan_heal_runs once the call has finished.
--
-- Idempotent. Rollback: supabase/rollbacks/20261007130000_plan_heal.down.sql

create table if not exists private.plan_heal_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  week_start date not null,
  dry_run boolean not null,
  checked integer not null,
  healed integer not null,
  report jsonb not null
);

revoke all on table private.plan_heal_runs from public, anon, authenticated;

-- One run's report, as the route sends it: { week, dryRun, courses: [...],
-- unreached }. "healed" counts the weeks re-cut and the full plans applied.
create or replace function public.record_plan_heal_run(
  _week_start date,
  _dry_run boolean,
  _report jsonb
)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  insert into private.plan_heal_runs (week_start, dry_run, checked, healed, report)
  select _week_start, _dry_run, count(*)::integer,
         (count(*) filter (where c ->> 'outcome' in ('healed', 'plan-applied')))::integer,
         _report
  from jsonb_array_elements(coalesce(_report -> 'courses', '[]'::jsonb)) c;
  delete from private.plan_heal_runs where ran_at < now() - interval '90 days';
end;
$function$;

revoke all on function public.record_plan_heal_run(date, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.record_plan_heal_run(date, boolean, jsonb) to service_role;

-- Knock on the route's door. Returns the pg_net request id, or null when Vault
-- lacks the practice worker's address or secret.
create or replace function private.kick_plan_heal(_dry_run boolean default false)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _worker text;
  _url text;
  _secret text;
begin
  select nullif(btrim(s.decrypted_secret), '') into _worker
  from vault.decrypted_secrets s where s.name = 'practice_worker_url';
  select nullif(btrim(s.decrypted_secret), '') into _secret
  from vault.decrypted_secrets s where s.name = 'practice_worker_secret';
  _url := regexp_replace(_worker, '/api/practice-worker/?$', '/api/plan-heal');
  if _url is null or _url = _worker or _secret is null then
    return null;
  end if;

  return net.http_post(
    url := _url,
    body := jsonb_build_object('dryRun', coalesce(_dry_run, false)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _secret
    ),
    timeout_milliseconds := 300000
  );
end;
$function$;

revoke all on function private.kick_plan_heal(boolean) from public, anon, authenticated;

select cron.unschedule('plan-heal')
 where exists (select 1 from cron.job where jobname = 'plan-heal');

select cron.schedule(
  'plan-heal',
  '30 2 * * *',
  $cron$ select private.kick_plan_heal(); $cron$
);
