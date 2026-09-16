-- Deleting a conversation, permanently.
--
-- The student who asked it, or any tutor, may delete a whole thread. It is the
-- whole thread, never single messages, so nobody can edit what was said by
-- removing one side of it. There is no soft delete and no bin: the rows are gone.
--
-- The message text also lives in the notification bell (the first 140
-- characters of each message), so those copies go too. They are matched on the
-- exact text and timestamp the fan-out trigger wrote: the trigger runs in the
-- same transaction as the message insert, so both got the same now().
--
-- An RPC rather than a DELETE policy because notifications have no client
-- DELETE policy, and the rule for who may delete belongs in one place.
create or replace function public.delete_chat_thread(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_thread public.chat_threads%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to delete a conversation.'; end if;

  select * into v_thread from public.chat_threads where id = p_thread_id for update;
  if not found then return; end if;

  if v_thread.student_id <> auth.uid()
     and not private.has_role(auth.uid(), 'tutor'::public.app_role) then
    raise exception 'You can only delete your own conversations.';
  end if;

  delete from public.notifications n
   using public.chat_messages m
   where m.thread_id = p_thread_id
     and n.type = 'chat_message'
     and n.user_id in (v_thread.student_id, v_thread.tutor_id)
     and n.created_at = m.created_at
     and n.body = left(m.body, 140);

  -- Messages go with it via ON DELETE CASCADE.
  delete from public.chat_threads where id = p_thread_id;
end;
$$;

revoke all on function public.delete_chat_thread(uuid) from public, anon;
grant execute on function public.delete_chat_thread(uuid) to authenticated;
