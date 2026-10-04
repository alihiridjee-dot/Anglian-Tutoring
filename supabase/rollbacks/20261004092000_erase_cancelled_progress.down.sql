-- Rollback for 20261004092000_erase_cancelled_progress.sql. Run by hand.
--
-- Stops the nightly erase. Anything it already erased is gone for good: this
-- only stops it erasing more. Put the app's wording back too (CancelPlanDialog,
-- RemoveSubjectDialog, /privacy), or the screens will promise a deletion that
-- no longer happens.

select cron.unschedule('erase-cancelled-progress')
 where exists (select 1 from cron.job where jobname = 'erase-cancelled-progress');

drop function if exists private.erase_cancelled_progress();
drop function if exists private.erase_subject_progress(uuid, public.subject);
