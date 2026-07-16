-- Auto-purge live sessions more than 7 days past. Past scheduled meetings are
-- over, so we hard-delete the resource row (cascading to resource_spec_points
-- and session_attendees). The Previous Sessions tab therefore only ever shows
-- the last 7 days of history.
create or replace function public.purge_stale_live_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  with removed as (
    delete from resources
    where kind = 'live_session'
      and starts_at is not null
      and starts_at < now() - interval '7 days'
    returning id
  )
  select count(*) into deleted_count from removed;
  return deleted_count;
end;
$$;

-- Schedule it daily at 03:00 UTC. Unschedule any prior job of the same name
-- first so re-running this migration is idempotent.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-stale-live-sessions') then
    perform cron.unschedule('purge-stale-live-sessions');
  end if;
  perform cron.schedule(
    'purge-stale-live-sessions',
    '0 3 * * *',
    $cron$select public.purge_stale_live_sessions();$cron$
  );
end;
$$;
