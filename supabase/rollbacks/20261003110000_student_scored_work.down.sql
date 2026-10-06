-- Rollback for 20261003110000_student_scored_work.sql. Roll the app back
-- first: the Parent Portal, the student dashboard and the tutor's Performance
-- tab read scores only through this function. Nothing is stored, so nothing
-- is lost.
begin;

drop function if exists public.student_scored_work(uuid, timestamptz);

commit;
