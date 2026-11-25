-- Undo 20261125100000_work_on_own_course: quiz attempts and task hand-ins are
-- checked by subject only again. Nothing filed is changed.

drop trigger if exists mcq_attempts_on_own_course on public.mcq_attempts;
drop trigger if exists homework_submissions_on_own_course on public.homework_submissions;
drop function if exists private.attempt_on_own_course();
drop function if exists private.submission_on_own_course();
drop function if exists private.on_my_course(uuid, text, text, text);
