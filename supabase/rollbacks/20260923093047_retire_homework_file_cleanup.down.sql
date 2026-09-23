-- DOWN for migrations/20260923093047_retire_homework_file_cleanup.sql.
--
-- Kept out of supabase/migrations on purpose: the CLI applies everything in
-- that folder, in order, and a rollback must only ever run by hand.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -f supabase/rollbacks/20260923093047_retire_homework_file_cleanup.down.sql
--
-- Reschedules the job exactly as it was, including the `extensions.net.http_post`
-- call that made every run fail. It does nothing useful without the edge
-- function and a `cron_service_role_key` Vault secret, neither of which this
-- restores.

begin;

select cron.schedule(
  'cleanup-homework-files-daily',
  '0 3 * * *',
  $cron$
  select extensions.net.http_post(
    url := 'https://peohauhwquuvghrpmotf.supabase.co/functions/v1/cleanup-homework-files',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'cron_service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);

commit;
