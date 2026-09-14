-- Abandoned homework drafts don't clean themselves up.
--
-- A draft is written as the student types and deleted by
-- `submit_homework_answers` the moment the work is handed in. That covers every
-- draft that becomes a submission. It covers none of the ones that don't — a
-- sheet opened, half-answered and never returned to leaves a row that nothing
-- in the system will ever remove.
--
-- The browser's copy expires on its own after fourteen days (`MAX_AGE_MS` in
-- `src/lib/homeworkDrafts.ts`); the server's had no equivalent, so this is the
-- one table in the homework set that grows without bound.
--
-- Thirty days, deliberately longer than the browser's fourteen. The two layers
-- are reconciled by whichever was written last, so the server copy has to
-- outlive the local one — otherwise a student returning on day twenty would
-- find the local copy expired, the server copy swept, and their work gone.
-- Revisiting a draft rewrites `updated_at`, so anything still being worked on
-- is never in scope.

create or replace function public.sweep_stale_homework_drafts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _deleted integer;
begin
  delete from public.homework_drafts
   where updated_at < now() - interval '30 days';

  get diagnostics _deleted = row_count;
  return _deleted;
end;
$$;

revoke all on function public.sweep_stale_homework_drafts() from public, anon, authenticated;

comment on function public.sweep_stale_homework_drafts() is
  'Removes homework drafts untouched for 30 days. Returns the number deleted. '
  'Scheduled nightly; safe to run by hand.';

-- Nightly rather than frequent: this is housekeeping on a table that will
-- usually have nothing to collect, and an off-peak hour keeps it away from the
-- five-minute mark publisher.
select cron.unschedule('sweep-homework-drafts')
 where exists (select 1 from cron.job where jobname = 'sweep-homework-drafts');

select cron.schedule(
  'sweep-homework-drafts',
  '20 3 * * *',
  $cron$ select public.sweep_stale_homework_drafts(); $cron$
);
