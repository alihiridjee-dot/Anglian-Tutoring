-- Undo 20261125222319_new_student_alerts: no more new-student emails. Nothing
-- a student sees changes.

select cron.unschedule('new-student-alerts')
where exists (select 1 from cron.job where jobname = 'new-student-alerts');

drop trigger if exists profiles_new_student_alert on public.profiles;
drop function if exists private.queue_new_student_alert();
drop table if exists public.new_student_alerts;
