-- DOWN for migrations/20260923114330_account_deletions.sql.
--
-- Kept out of supabase/migrations on purpose: the CLI applies everything in
-- that folder, in order, and a rollback must only ever run by hand.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -f supabase/rollbacks/20260923114330_account_deletions.down.sql
--
-- Stops the hourly purge and drops the requests table. Check for open rows
-- first (status = 'scheduled'): those students are banned and their plans
-- paused, and dropping the table forgets that without undoing either.

begin;

select cron.unschedule('purge-deleted-accounts')
where exists (select 1 from cron.job where jobname = 'purge-deleted-accounts');

drop table if exists public.account_deletions;

commit;
