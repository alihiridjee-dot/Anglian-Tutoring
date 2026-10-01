-- DOWN for migrations/20261001130000_chat_reaches_only_tutors_and_linked_parents.sql.
--
-- Kept out of supabase/migrations on purpose: the CLI applies everything in
-- that folder, in order, and a rollback must only ever run by hand.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -f supabase/rollbacks/20261001130000_chat_reaches_only_tutors_and_linked_parents.down.sql
--
-- Read this first. Rolling back reopens both holes: any member can address a
-- thread, and so a notification, to any user; and a removed parent keeps their
-- conversation about the child. Invite codes already rotated stay rotated.

begin;

drop trigger if exists rotate_invite_code_on_unlink on public.parent_student_links;
drop function if exists private.rotate_invite_code_on_unlink();

-- The fan-out trigger as 20260926083808 left it.
create or replace function public.on_chat_message_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_thread public.chat_threads%rowtype;
  v_from_student boolean;
  v_parent_thread boolean;
  v_recipient uuid;
  v_sender_name text;
begin
  select * into v_thread from public.chat_threads where id = new.thread_id;
  if not found then return new; end if;

  v_from_student := (new.sender_id = v_thread.student_id);
  v_parent_thread := (v_thread.about_student_id is not null);
  v_recipient := case when v_from_student then v_thread.tutor_id else v_thread.student_id end;

  update public.chat_threads
     set last_message_at = new.created_at,
         status = case when v_from_student then 'open' else 'answered' end,
         student_last_read_at =
           case when v_from_student then new.created_at else student_last_read_at end,
         tutor_last_read_at =
           case when v_from_student then tutor_last_read_at else new.created_at end
   where id = new.thread_id;

  if v_recipient is null or v_recipient = new.sender_id then
    return new;
  end if;

  select coalesce(nullif(btrim(p.display_name), ''),
           case
             when not v_from_student then 'Your tutor'
             when v_parent_thread then 'A parent'
             else 'Your student'
           end)
    into v_sender_name
    from public.profiles p where p.id = new.sender_id;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_recipient,
    'chat_message',
    case
      when not v_from_student then 'Reply from ' || v_sender_name
      when v_parent_thread then v_sender_name || ' sent you a message'
      else v_sender_name || ' sent you a question'
    end,
    left(new.body, 140),
    case when v_parent_thread and not v_from_student then '/parent-dashboard' else '/messages' end
  );

  return new;
end;
$function$;
revoke all on function public.on_chat_message_insert() from public, anon, authenticated;

-- The read-state and delete functions as 20260803231700 and 20260916120000.
create or replace function public.mark_chat_thread_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_student uuid;
begin
  select student_id into v_student from public.chat_threads where id = p_thread_id;
  if not found then return; end if;

  if v_student = auth.uid() then
    update public.chat_threads set student_last_read_at = now() where id = p_thread_id;
  elsif private.has_role(auth.uid(), 'tutor'::public.app_role) then
    update public.chat_threads set tutor_last_read_at = now() where id = p_thread_id;
  end if;
end;
$$;
revoke all on function public.mark_chat_thread_read(uuid) from public, anon;
grant execute on function public.mark_chat_thread_read(uuid) to authenticated;

create or replace function public.chat_unread_count()
returns integer
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select coalesce(count(m.id), 0)::int
  from public.chat_messages m
  join public.chat_threads t on t.id = m.thread_id
  where (select auth.uid()) is not null
    and m.sender_id <> (select auth.uid())
    and (
      (t.student_id = (select auth.uid())
        and m.created_at > coalesce(t.student_last_read_at, '-infinity'::timestamptz))
      or (private.has_role((select auth.uid()), 'tutor'::public.app_role)
        and t.student_id <> (select auth.uid())
        and m.created_at > coalesce(t.tutor_last_read_at, '-infinity'::timestamptz))
    )
$$;
revoke all on function public.chat_unread_count() from public, anon;
grant execute on function public.chat_unread_count() to authenticated;

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

  delete from public.chat_threads where id = p_thread_id;
end;
$$;
revoke all on function public.delete_chat_thread(uuid) from public, anon;
grant execute on function public.delete_chat_thread(uuid) to authenticated;

-- The policies as 20260803231626 and 20260926083808 left them.
drop policy if exists "chat_messages read participants" on public.chat_messages;
create policy "chat_messages read participants" on public.chat_messages
  for select
  using (
    exists (
      select 1 from public.chat_threads t
      where t.id = chat_messages.thread_id
        and (
          t.student_id = (select auth.uid())
          or private.has_role((select auth.uid()), 'tutor'::public.app_role)
        )
    )
  );

drop policy if exists "chat_messages send as self" on public.chat_messages;
create policy "chat_messages send as self" on public.chat_messages
  for insert
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.chat_threads t
      where t.id = chat_messages.thread_id
        and (
          t.student_id = (select auth.uid())
          or private.has_role((select auth.uid()), 'tutor'::public.app_role)
        )
    )
  );

drop policy if exists "chat_threads tutors update" on public.chat_threads;
drop policy if exists "chat_threads participants update" on public.chat_threads;
create policy "chat_threads participants update" on public.chat_threads
  for update to authenticated
  using (
    student_id = (select auth.uid())
    or private.has_role((select auth.uid()), 'tutor'::public.app_role)
  )
  with check (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    or (
      student_id = (select auth.uid())
      and (
        about_student_id is null
        or exists (
          select 1 from public.parent_student_links l
          where l.parent_id = (select auth.uid())
            and l.student_id = chat_threads.about_student_id
        )
      )
    )
  );

drop policy if exists "chat_threads member creates own" on public.chat_threads;
create policy "chat_threads member creates own" on public.chat_threads
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and case
      when exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role = 'parent'
      )
        then about_student_id is not null
          and exists (
            select 1 from public.parent_student_links l
            where l.parent_id = (select auth.uid())
              and l.student_id = chat_threads.about_student_id
          )
      else about_student_id is null
    end
  );

drop policy if exists "chat_threads read own or tutor" on public.chat_threads;
create policy "chat_threads read own or tutor" on public.chat_threads
  for select
  using (
    student_id = (select auth.uid())
    or private.has_role((select auth.uid()), 'tutor'::public.app_role)
  );

drop function if exists private.chat_member_can_see(uuid, uuid);
drop function if exists private.is_tutor(uuid);

commit;
