-- M-26: three gaps in how long chat is kept.
--
-- 1. A thread answered by a different tutor never expired. The 30-day sweep
--    (20260813120000) only counted a reply from the tutor the thread was
--    addressed to, but any tutor may answer any thread. It now counts a reply
--    from anyone other than the thread's member. An unanswered question is
--    still never swept.
--
-- 2. Chat notifications outlived their thread. They carried no thread id, so
--    the sweep and an account deletion left the message text sitting in the
--    bell. They now record their thread (notifications.chat_thread_id) and go
--    with it: ON DELETE CASCADE from the sweep, from delete_chat_thread and
--    from a member's account deletion (their threads cascade from profiles).
--
-- 3. Deleting a tutor's account deleted their replies. chat_messages.sender_id
--    was ON DELETE CASCADE, so a family's thread survived with the tutor's
--    half cut out, the opposite of what chat_threads.tutor_id's comment
--    promises. Ali decided (3 Oct 2026) that the replies stay: sender_id is now
--    nullable and ON DELETE SET NULL. A null sender is a deleted tutor's reply
--    (a member's own deletion removes the whole thread). Those replies still
--    count as unread, and still count as "answered" for the sweep, so
--    `is distinct from` replaces `<>` / `=` wherever sender_id is compared.
--
-- Function bodies start from production's live definitions (pg_get_functiondef,
-- 3 Oct 2026). Production holds no chat rows today, so nothing is backfilled.
-- Independent of any app release: apply any time.

-- ── 3. Keep a deleted tutor's replies ──────────────────────────────────────
alter table public.chat_messages alter column sender_id drop not null;
alter table public.chat_messages drop constraint if exists chat_messages_sender_id_fkey;
alter table public.chat_messages
  add constraint chat_messages_sender_id_fkey
  foreign key (sender_id) references public.profiles(id) on delete set null;

comment on column public.chat_messages.sender_id is
  'Who wrote it. Null once a tutor''s account is deleted: their replies stay in the family''s thread. A member''s own deletion removes the whole thread.';

-- ── 2. Chat notifications belong to their thread ───────────────────────────
alter table public.notifications
  add column if not exists chat_thread_id uuid
  references public.chat_threads(id) on delete cascade;
create index if not exists notifications_chat_thread_id_idx
  on public.notifications (chat_thread_id)
  where chat_thread_id is not null;

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

  -- A thread's "tutor" is whatever id its member wrote there. Only notify it
  -- if it really is a tutor, or anyone could post into anyone's bell.
  if v_from_student and not exists (
    select 1 from public.user_roles r
    where r.user_id = v_recipient and r.role = 'tutor'::public.app_role
  ) then
    return new;
  end if;

  -- A parent who has been unlinked from the child no longer hears about them.
  if v_parent_thread and not v_from_student and not exists (
    select 1 from public.parent_student_links l
    where l.parent_id = v_thread.student_id and l.student_id = v_thread.about_student_id
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

  -- chat_thread_id ties the notification to its thread, so it is deleted
  -- with it (M-26).
  insert into public.notifications (user_id, type, title, body, link, chat_thread_id)
  values (
    v_recipient,
    'chat_message',
    case
      when not v_from_student then 'Reply from ' || v_sender_name
      when v_parent_thread then v_sender_name || ' sent you a message'
      else v_sender_name || ' sent you a question'
    end,
    left(new.body, 140),
    case when v_parent_thread and not v_from_student then '/parent-dashboard' else '/messages' end,
    new.thread_id
  );

  return new;
end;
$function$;

-- ── 1. Expire a thread once any tutor has replied ──────────────────────────
create or replace function public.expire_stale_chat_threads()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _deleted integer;
begin
  -- "Answered" is a reply from anyone but the thread's member: only tutors
  -- can write there besides the member, and a null sender is a deleted
  -- tutor's reply.
  delete from chat_threads t
  where t.last_message_at < now() - interval '30 days'
    and exists (
      select 1
      from chat_messages m
      where m.thread_id = t.id
        and m.sender_id is distinct from t.student_id
    );
  get diagnostics _deleted = row_count;
  return _deleted;
end
$function$;

revoke all on function public.expire_stale_chat_threads() from public, anon, authenticated;

-- ── The badge keeps counting a deleted tutor's unread reply ────────────────
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
