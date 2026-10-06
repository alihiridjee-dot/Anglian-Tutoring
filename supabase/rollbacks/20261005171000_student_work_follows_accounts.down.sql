-- Rollback for 20261005171000_student_work_follows_accounts.sql. Run by hand.
--
-- Drops the three foreign keys and the index, so a student's submissions, quiz
-- attempts and attendance outlive a deleted account again unless the
-- delete-account purge removes them. The rows the migration deleted are not
-- brought back: each belonged to an account that no longer exists.
alter table public.homework_submissions drop constraint if exists homework_submissions_student_id_fkey;
alter table public.mcq_attempts drop constraint if exists mcq_attempts_user_id_fkey;
alter table public.session_attendees drop constraint if exists session_attendees_user_id_fkey;
drop index if exists public.idx_session_attendees_user;
