-- Rollback for 20261003111000_student_engagement.sql. Roll the app back
-- first: the Parent Portal and the tutor's Performance tab count engagement
-- only through this function. Nothing is stored, so nothing is lost.
begin;

drop function if exists public.student_engagement(uuid);

commit;
