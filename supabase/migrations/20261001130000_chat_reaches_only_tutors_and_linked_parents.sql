-- Chat reaches only tutors, and a parent only while they are linked.
--
-- Two holes in who a conversation reaches.
--
-- 1. Nothing checked that a thread's `tutor_id` was a tutor. A member could
--    open a thread "to" any user id, or point their own thread at one, and
--    every message they sent then landed in that user's notification bell:
--    their chosen display name and the first 140 characters, in a child's
--    bell as easily as a tutor's. Members could also rewrite their thread's
--    `last_message_at` and `tutor_last_read_at`, pinning it to the top of every
--    tutor's inbox or hiding it as read.
-- 2. A parent's thread checked the link only when it was opened. After the
--    child or a tutor removed the parent, the parent could still read the
--    thread, post in it and be notified of every tutor reply about the child.
--    And the child's invite code, all a parent needs to link, stayed the same,
--    so a removed parent could link straight back.
--
--   private.is_tutor()          whether a user is a tutor. has_role() refuses
--                               to answer a student about anyone else; this
--                               says no more than tutor_directory() lists.
--   private.chat_member_can_see whether the caller is a thread's member, and
--                               for a parent's thread, still linked to the
--                               child it is about.
--   threads                     opened only to a tutor. Updated only by
--                               tutors: a member's read state goes through
--                               mark_chat_thread_read() and the bump through
--                               the message trigger, both definer functions.
--   parent threads              read, written and deleted by the parent only
--                               while the link stands. Tutors keep the whole
--                               history, and it returns if the parent is
--                               linked again.
--   notifications               a member's message notifies only a tutor; a
--                               reply notifies a parent only while linked.
--   unlinking                   gives the child a new invite code, whoever
--                               unlinks and however: the RPC, a tutor, or an
--                               account deletion.
--
-- Idempotent. Rollback: supabase/rollbacks/20261001130000_chat_reaches_only_tutors_and_linked_parents.down.sql

begin;

-- ── 1 · Helpers ────────────────────────────────────────────────────────────

create or replace function private.is_tutor(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = _user_id and r.role = 'tutor'::public.app_role
  )
$$;
revoke all on function private.is_tutor(uuid) from public, anon;
grant execute on function private.is_tutor(uuid) to authenticated, service_role;

-- Answers only for the caller, so it reveals nothing about anyone else's links.
create or replace function private.chat_member_can_see(_member uuid, _about uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select _member = (select auth.uid())
     and (
       _about is null
       or exists (
         select 1 from public.parent_student_links l
         where l.parent_id = _member and l.student_id = _about
       )
     )
$$;
revoke all on function private.chat_member_can_see(uuid, uuid) from public, anon;
grant execute on function private.chat_member_can_see(uuid, uuid) to authenticated, service_role;

-- ── 2 · Threads ────────────────────────────────────────────────────────────

drop policy if exists "chat_threads read own or tutor" on public.chat_threads;
create policy "chat_threads read own or tutor" on public.chat_threads
  for select
  using (
    private.chat_member_can_see(student_id, about_student_id)
    or private.has_role((select auth.uid()), 'tutor'::public.app_role)
  );

-- As 20260926083808, plus: the thread must be addressed to a tutor.
drop policy if exists "chat_threads member creates own" on public.chat_threads;
create policy "chat_threads member creates own" on public.chat_threads
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and private.is_tutor(tutor_id)
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

drop policy if exists "chat_threads participants update" on public.chat_threads;
drop policy if exists "chat_threads tutors update" on public.chat_threads;
create policy "chat_threads tutors update" on public.chat_threads
  for update to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::public.app_role))
  with check (private.has_role((select auth.uid()), 'tutor'::public.app_role));

-- ── 3 · Messages ───────────────────────────────────────────────────────────

drop policy if exists "chat_messages read participants" on public.chat_messages;
create policy "chat_messages read participants" on public.chat_messages
  for select
  using (
    exists (
      select 1 from public.chat_threads t
      where t.id = chat_messages.thread_id
        and (
          private.chat_member_can_see(t.student_id, t.about_student_id)
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
          private.chat_member_can_see(t.student_id, t.about_student_id)
          or private.has_role((select auth.uid()), 'tutor'::public.app_role)
        )
    )
  );

-- ── 4 · The definer functions follow the same rule ─────────────────────────

-- As 20260916120000; a member must still be able to see the thread.
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

  if not private.chat_member_can_see(v_thread.student_id, v_thread.about_student_id)
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

-- As 20260803231700; a hidden thread's messages don't count.
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
      (private.chat_member_can_see(t.student_id, t.about_student_id)
        and m.created_at > coalesce(t.student_last_read_at, '-infinity'::timestamptz))
      or (private.has_role((select auth.uid()), 'tutor'::public.app_role)
        and t.student_id <> (select auth.uid())
        and m.created_at > coalesce(t.tutor_last_read_at, '-infinity'::timestamptz))
    )
$$;
revoke all on function public.chat_unread_count() from public, anon;
grant execute on function public.chat_unread_count() to authenticated;

-- As 20260803231700; marking a hidden thread read does nothing.
create or replace function public.mark_chat_thread_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
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
$$;
revoke all on function public.mark_chat_thread_read(uuid) from public, anon;
grant execute on function public.mark_chat_thread_read(uuid) to authenticated;

-- ── 5 · Who is notified ─────────────────────────────────────────────────────

-- As 20260926083808, plus two checks before the notification is written:
-- a member's message goes only to a tutor, and a reply reaches a parent only
-- while they are linked to the child the thread is about.
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

  -- Bump the thread, and mark the sender's own side read: you have by
  -- definition seen the message you just sent.
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

  if v_from_student and not private.is_tutor(v_recipient) then
    return new;
  end if;

  if not v_from_student and v_parent_thread and not exists (
    select 1 from public.parent_student_links l
    where l.parent_id = v_recipient and l.student_id = v_thread.about_student_id
  ) then
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

-- ── 6 · Unlinking gives the child a new invite code ────────────────────────

-- Existing links stay as they are (see rotate_student_invite_code); the code
-- a removed parent holds simply stops working.
create or replace function private.rotate_invite_code_on_unlink()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set student_invite_code = public.gen_student_invite_code()
   where id = old.student_id;
  return old;
end;
$$;
revoke all on function private.rotate_invite_code_on_unlink() from public, anon, authenticated;

drop trigger if exists rotate_invite_code_on_unlink on public.parent_student_links;
create trigger rotate_invite_code_on_unlink
  after delete on public.parent_student_links
  for each row execute function private.rotate_invite_code_on_unlink();

commit;
