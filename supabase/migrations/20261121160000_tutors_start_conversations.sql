-- A tutor can start a conversation, not only answer one.
--
-- Until now only a thread's member (a student, or a parent writing about a
-- linked child) could open a thread: the one insert policy asks for
-- student_id = auth.uid(). A tutor could read and reply to every thread but
-- could not write first. Ali, 21 Nov 2026: "i should not just be able to
-- respond to messages but send them too".
--
-- 1. A second insert policy, for tutors. The thread is opened the same way a
--    member opens one (student_id is the member, about_student_id the child a
--    parent's thread is about), with three limits:
--      - tutor_id is null, so the member's replies ring every tutor, the same
--        as a student's question to the team (on_chat_message_insert,
--        20261007100338). Ali chose "the whole team" for replies.
--      - a thread with no about_student_id is with a student: the member's
--        profile says 'student'.
--      - a thread with about_student_id is with a parent who is linked to that
--        child right now, and whose profile says 'parent'.
--    The policy's lookups run as the tutor, who may read every profile and
--    every link. refuse_student_row_for_staff (20261003115242) already stops
--    a tutor's id landing in student_id or about_student_id.
--    The member insert policy is unchanged. Permissive policies are OR'd, so
--    a student or parent opens a thread exactly as before.
--
-- 2. The bell. A tutor's message used to be titled "Reply from <tutor>",
--    which is wrong for the first message of a conversation the tutor
--    started. The first message in a thread is now "Message from <tutor>".
--    Nothing else in the function changes: the body is production's live
--    definition (pg_get_functiondef, 21 Nov 2026; last written by
--    20261007100338), with v_first added and one line in the title case.
--
-- Safe before or after the app: the app now live never opens a thread as a
-- tutor, and a student's or parent's thread starts with their own message, so
-- the new title is only ever reached by a tutor-opened thread.
--
-- Rollback: supabase/rollbacks/20261121160000_tutors_start_conversations.down.sql

begin;

drop policy if exists "chat_threads tutor opens with a member" on public.chat_threads;
create policy "chat_threads tutor opens with a member" on public.chat_threads
  for insert to authenticated
  with check (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    and tutor_id is null
    and case
      when about_student_id is null then exists (
        select 1 from public.profiles p
        where p.id = chat_threads.student_id
          and p.role = 'student'::public.profile_role
      )
      else exists (
        select 1
        from public.parent_student_links l
        join public.profiles p on p.id = l.parent_id
        where l.parent_id = chat_threads.student_id
          and l.student_id = chat_threads.about_student_id
          and p.role = 'parent'::public.profile_role
      )
    end
  );

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
  v_to_team boolean;
  v_recipient uuid;
  v_sender_name text;
  v_first boolean;
begin
  select * into v_thread from public.chat_threads where id = new.thread_id;
  if not found then return new; end if;

  v_from_student := (new.sender_id = v_thread.student_id);
  v_parent_thread := (v_thread.about_student_id is not null);
  v_recipient := case when v_from_student then v_thread.tutor_id else v_thread.student_id end;
  -- No tutor named: the question is for every tutor.
  v_to_team := v_from_student and v_thread.tutor_id is null;

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

  if not v_to_team and (v_recipient is null or v_recipient = new.sender_id) then
    return new;
  end if;

  -- A thread's "tutor" is whatever id its member wrote there. Only notify it
  -- if it really is a tutor, or anyone could post into anyone's bell.
  if v_from_student and not v_to_team and not exists (
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

  -- A tutor's first message opens the conversation; it answers nothing.
  v_first := not v_from_student and not exists (
    select 1 from public.chat_messages m
    where m.thread_id = new.thread_id and m.id <> new.id
  );

  -- chat_thread_id ties the notification to its thread, so it is deleted
  -- with it (M-26).
  insert into public.notifications (user_id, type, title, body, link, chat_thread_id)
  select
    u.id,
    'chat_message',
    case
      when v_first then 'Message from ' || v_sender_name
      when not v_from_student then 'Reply from ' || v_sender_name
      when v_parent_thread then v_sender_name || ' sent you a message'
      else v_sender_name || ' sent you a question'
    end,
    left(new.body, 140),
    case when v_parent_thread and not v_from_student then '/parent-dashboard' else '/messages' end,
    new.thread_id
  from (
    select v_recipient as id where not v_to_team
    union
    select r.user_id from public.user_roles r
     where v_to_team
       and r.role = 'tutor'::public.app_role
       and r.user_id <> new.sender_id
  ) u;

  return new;
end;
$function$;

commit;
