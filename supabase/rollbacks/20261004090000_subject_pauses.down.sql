-- Rollback for 20261004090000_subject_pauses.sql. Run by hand.
--
-- Removes the hard stop (weeks can be planned for a paused subject again), the
-- triggers that keep the record, the hourly job and the record itself. The
-- record is the only history of when subjects were paused: export it first if
-- it will be wanted.

select cron.unschedule('sync-subject-pauses')
 where exists (select 1 from cron.job where jobname = 'sync-subject-pauses');

drop trigger if exists plan_not_while_paused on public.student_weekly_plans;
drop trigger if exists plan_point_not_while_paused on public.student_weekly_plan_points;
drop function if exists private.refuse_planning_while_paused();

drop trigger if exists subject_pauses_follow_subscription on public.subscriptions;
drop trigger if exists subject_pauses_follow_enrolment on public.student_enrolments;
drop trigger if exists subject_pauses_follow_courses on public.profiles;
drop function if exists private.sync_subject_pauses_after_change();
drop function if exists private.sync_subject_pauses(uuid);

drop table if exists public.student_subject_pauses;
