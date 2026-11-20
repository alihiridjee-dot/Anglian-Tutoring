-- A signed-in student changes only the four fields their screens set on their
-- own enrolment rows (audit finding L15).
--
-- Subjects are added and removed only through save_student_enrolments (the
-- student's onboarding) and apply_enrolment_change (billing, service role).
-- Both are SECURITY DEFINER, so "enrolments self insert" and "enrolments self
-- delete" are used by nothing and go.
--
-- "enrolments self update" stays: the board switch (useUpdateEnrolmentBoard),
-- the target grade on the predicted-grade card (useSetTargetGrade) and
-- onboarding step 3 update the student's own row directly. But a table-wide
-- UPDATE grant let that policy through for every column, so a student could
-- also turn one enrolled subject into another (or rewrite created_at) without
-- either function. As on `profiles` (20260806232240), the table grant is
-- dropped and exactly the columns the app writes are granted back. That holds
-- for the tutor's record page too (StudentsDAL.updateEnrolment, EnrolmentPatch
-- = the same four columns). Checked 19 Nov 2026: no other client write, and no
-- function running as the caller writes this table.
--
-- Confirm with:
--
--   select column_name from information_schema.column_privileges
--   where table_schema = 'public' and table_name = 'student_enrolments'
--     and grantee = 'authenticated' and privilege_type = 'UPDATE';

drop policy if exists "enrolments self insert" on public.student_enrolments;
drop policy if exists "enrolments self delete" on public.student_enrolments;

-- Revoking the table privilege also clears the column grants, so a second run
-- ends in the same state.
revoke update on public.student_enrolments from authenticated;
grant update (board, previous_grade, current_grade, target_grade)
  on public.student_enrolments to authenticated;
