-- Rollback for 20261028111700_chat_read_clears_bell: mark_chat_thread_read as
-- it was live before (pg_get_functiondef, 28 Oct 2026). Reading a thread then
-- moves its watermark only, and the bell keeps its notifications unread.

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
  end if;
end;
$function$;
