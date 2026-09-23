-- Retires `cleanup-homework-files-daily`, a leftover of the file era.
--
-- The job posted to the `cleanup-homework-files` edge function each night to
-- delete submission photos a week after marking. Submissions have been typed
-- answers since 20260909150000, so there is nothing left for it to delete: no
-- object sits under `resources/submissions/`, and no submission carries files.
--
-- It never ran once anyway. All 70 runs from 2026-07-16 to 2026-09-23 failed on
-- `extensions.net.http_post` ("cross-database references are not
-- implemented"), and the Vault secret it would have sent, `cron_service_role_key`,
-- does not exist.
--
-- The edge function itself is deleted from the dashboard, not here. Its source
-- was never in the repo; the commit that adds this file records it.

select cron.unschedule('cleanup-homework-files-daily')
 where exists (select 1 from cron.job where jobname = 'cleanup-homework-files-daily');
