-- Student work: deleted with the account, however the account is deleted.
--
-- homework_submissions.student_id, mcq_attempts.user_id and
-- session_attendees.user_id had no foreign key, so a student's task
-- submissions, quiz attempts and live-lesson attendance outlived the account.
-- The delete-account purge removes them itself, but only for a student deleted
-- with the tutor's Delete button: an account deleted from the dashboard or by a
-- script left them behind. On 5 Oct 2026 one submission in production belonged
-- to a deleted account. It was sent on 18 Sep and never marked, and it held 5
-- answers and an AI mark. The account had no profile and no account_deletions
-- row, so it was deleted outside the app. No quiz attempt or attendance row was
-- left behind.
--
-- So: delete those rows, then make each id reference auth.users with ON DELETE
-- CASCADE, as homework_drafts and the planner tables do. The rows now go with
-- the account in the same transaction, whatever deletes it, and a row naming an
-- account that doesn't exist is refused. A submission takes its answers, AI
-- marks and notifications with it through their own cascades, as the purge's
-- delete already does.
--
-- Submissions stay final (20260715130000): a student still can't delete their
-- own. Only the server deletes accounts. A cascade runs as the table's owner,
-- so row-level security doesn't stop it.
--
-- Files are not covered: no foreign key reaches Storage. On 5 Oct nothing sat
-- under resources/submissions/ (docs/SECURITY_AUDIT_2026-10.md, finding 5).
--
-- session_attendees.user_id gets an index, so the cascade finds a student's
-- rows without reading the whole table. The other two columns have one already.
--
-- Safe to run twice. Adding a foreign key stops writes to auth.users until the
-- transaction ends, so sign-ins wait for it. The lock timeout makes a busy
-- table fail this, to be run again, rather than hold every sign-in behind it.
do $$
begin
  perform set_config('lock_timeout', '5s', true);

  delete from public.homework_submissions h
   where not exists (select 1 from auth.users u where u.id = h.student_id);
  delete from public.mcq_attempts a
   where not exists (select 1 from auth.users u where u.id = a.user_id);
  delete from public.session_attendees s
   where not exists (select 1 from auth.users u where u.id = s.user_id);

  create index if not exists idx_session_attendees_user on public.session_attendees(user_id);

  if not exists (select 1 from pg_constraint where conname = 'homework_submissions_student_id_fkey'
                 and conrelid = 'public.homework_submissions'::regclass) then
    alter table public.homework_submissions add constraint homework_submissions_student_id_fkey
      foreign key (student_id) references auth.users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mcq_attempts_user_id_fkey'
                 and conrelid = 'public.mcq_attempts'::regclass) then
    alter table public.mcq_attempts add constraint mcq_attempts_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'session_attendees_user_id_fkey'
                 and conrelid = 'public.session_attendees'::regclass) then
    alter table public.session_attendees add constraint session_attendees_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end
$$;
