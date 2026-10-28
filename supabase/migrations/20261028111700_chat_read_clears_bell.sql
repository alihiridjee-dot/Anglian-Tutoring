-- Reading a conversation clears it from the notification bell.
--
-- mark_chat_thread_read moved only the thread's read watermark. The Messages
-- badge cleared the moment a reply was read, but the bell kept "Reply from …"
-- unread, and only "All read" in the bell cleared it. It now also marks the
-- caller's own notifications for that conversation read: the rows with
-- user_id = auth.uid() and this chat_thread_id, nobody else's.
--
-- The body is the live definition (pg_get_functiondef, 28 Oct 2026). Two
-- changes: a caller who can see neither side of the thread returns early, as
-- before but explicitly, and the update on notifications at the end.
--
-- Rollback: supabase/rollbacks/20261028111700_chat_read_clears_bell.down.sql

create or replace function public.mark_chat_thread_read(p_thread_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_thread public.chat_threads%rowtype;
begin
  select * into v_thread from public.chat_threads where id = p_thread_id;
  if not found then return; end if;

  if private.chat_member_can_see(v_thread.student_id, v_thread.about_student_id) then
    update public.chat_threads set student_last_read_at = now() where id = p_thread_id;
  elsif private.has_role(auth.uid(), 'tutor'::public.app_role) then
    update public.chat_threads set tutor_last_read_at = now() where id = p_thread_id;
  else
    return;
  end if;

  -- The bell's copies of this conversation are read along with it.
  update public.notifications
     set read_at = now()
   where user_id = auth.uid()
     and chat_thread_id = p_thread_id
     and read_at is null;
end;
$function$;
