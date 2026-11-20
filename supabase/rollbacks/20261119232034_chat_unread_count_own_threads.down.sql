-- Rollback for 20261119232034_chat_unread_count_own_threads: chat_unread_count
-- as it was live before (pg_get_functiondef, 19 Nov 2026; md5 of prosrc
-- ac474aca4d46caf41cc0a33ec8b1e0b3, the body of 20261003100000). Same answer;
-- it reads every message again on each poll.

create or replace function public.chat_unread_count()
 returns integer
 language sql
 stable security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
  select coalesce(count(m.id), 0)::int
  from public.chat_messages m
  join public.chat_threads t on t.id = m.thread_id
  where (select auth.uid()) is not null
    and m.sender_id is distinct from (select auth.uid())
    and (
      (private.chat_member_can_see(t.student_id, t.about_student_id)
        and m.created_at > coalesce(t.student_last_read_at, '-infinity'::timestamptz))
      or (private.has_role((select auth.uid()), 'tutor'::public.app_role)
        and t.student_id <> (select auth.uid())
        and m.created_at > coalesce(t.tutor_last_read_at, '-infinity'::timestamptz))
    )
$function$;

revoke all on function public.chat_unread_count() from public, anon;
grant execute on function public.chat_unread_count() to authenticated;
