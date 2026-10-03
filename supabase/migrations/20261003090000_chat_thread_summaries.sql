-- M-25: the inbox's unread counts and last lines, worked out on the server.
--
-- ChatDAL.listThreads used to read every message of every thread in one select
-- and count them in the browser. PostgREST returns at most 1,000 rows, so once
-- a tutor's inbox passed that the newest messages were the ones cut off: unread
-- counts came out low, last lines went stale, and an unanswered thread could
-- fold away under "Show older conversations" as if it had gone quiet.
--
-- This returns one row per thread instead, however many messages there are.
--
-- SECURITY INVOKER on purpose: the caller's own row-level security decides
-- which threads and messages are counted, exactly as the select it replaces
-- did. A tutor sees every thread; a student or parent only their own (and a
-- parent loses a thread once unlinked from the child it is about).
--
-- The watermark is the viewer's side of the thread: the member's when the
-- caller is the thread's member, the tutors' otherwise. A message the viewer
-- sent never counts as unread. `is distinct from` keeps a reply whose sender
-- account has gone (sender_id null) counted.
--
-- The app calls this, so apply it BEFORE merging the app change.
create or replace function public.chat_thread_summaries(p_thread_ids uuid[])
returns table (thread_id uuid, unread integer, last_message text)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    t.id,
    (
      select count(*)::int
      from public.chat_messages m
      where m.thread_id = t.id
        and m.sender_id is distinct from (select auth.uid())
        and m.created_at > coalesce(
          case when t.student_id = (select auth.uid())
               then t.student_last_read_at
               else t.tutor_last_read_at
          end,
          '-infinity'::timestamptz)
    ),
    (
      select m.body
      from public.chat_messages m
      where m.thread_id = t.id
      order by m.created_at desc, m.id desc
      limit 1
    )
  from public.chat_threads t
  where t.id = any(p_thread_ids)
    and (select auth.uid()) is not null
$$;

revoke all on function public.chat_thread_summaries(uuid[]) from public, anon;
grant execute on function public.chat_thread_summaries(uuid[]) to authenticated;
