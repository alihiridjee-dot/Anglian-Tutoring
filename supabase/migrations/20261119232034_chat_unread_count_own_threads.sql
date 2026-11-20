-- The unread badge looks at the caller's threads only. (Audit finding M7,
-- 18 Nov 2026.)
--
-- chat_unread_count() runs every 20 seconds for every signed-in user (the
-- Messages badge, src/hooks/data/useChat.ts). It joined every message to every
-- thread and called two definer functions on each row (chat_member_can_see and
-- has_role), so each poll read the whole chat history, whoever asked.
--
-- Same answer, cheaper plan. The count is now its two halves added together.
-- No message can be in both: the member half needs the thread's student_id to
-- be the caller, the tutor half needs it not to be (student_id is never null).
--   member  a plain `t.student_id = auth.uid()` comes first, so only the
--           caller's own threads are read (chat_threads_student_idx, then
--           chat_messages_thread_idx from the read mark on).
--           chat_member_can_see still decides, unchanged, on those few rows,
--           so a parent whose link was removed still counts nothing.
--   tutor   the role check is a one-row subquery, run once per call. For
--           anyone who is not a tutor the whole half is skipped.
-- With no caller, both halves match nothing, as before.
--
-- Built from 20261003100000, production's live definition (pg_get_functiondef,
-- 19 Nov 2026; md5 of prosrc ac474aca4d46caf41cc0a33ec8b1e0b3). Same signature,
-- language, volatility, security and search_path; grants re-stated as
-- 20261001111430 set them. No table or index changes: both indexes exist live.
-- Idempotent.
--
-- Rollback: supabase/rollbacks/20261119232034_chat_unread_count_own_threads.down.sql

create or replace function public.chat_unread_count()
 returns integer
 language sql
 stable security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
  select (
    (select count(*)
       from public.chat_threads t
       join public.chat_messages m on m.thread_id = t.id
      where t.student_id = (select auth.uid())
        and private.chat_member_can_see(t.student_id, t.about_student_id)
        and m.sender_id is distinct from (select auth.uid())
        and m.created_at > coalesce(t.student_last_read_at, '-infinity'::timestamptz))
    +
    (select count(*)
       from public.chat_threads t
       join public.chat_messages m on m.thread_id = t.id
      where (select private.has_role((select auth.uid()), 'tutor'::public.app_role))
        and t.student_id <> (select auth.uid())
        and m.sender_id is distinct from (select auth.uid())
        and m.created_at > coalesce(t.tutor_last_read_at, '-infinity'::timestamptz))
  )::int
$function$;

revoke all on function public.chat_unread_count() from public, anon;
grant execute on function public.chat_unread_count() to authenticated;
