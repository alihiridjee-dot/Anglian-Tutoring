-- A student's question goes to the team, not to one tutor.
--
-- "Ask your tutor" used to make the student pick a tutor by name (Ali,
-- nadia-louise). Since 7 Oct it says "The team" and opens the thread with no
-- tutor_id. Any tutor could already read and answer any thread; what a null
-- tutor_id lacked was the bell — the trigger only ever notified tutor_id, so a
-- question to the team would have reached no one.
--
-- Now a member's message on a thread with no tutor notifies every tutor. That
-- also covers a thread whose tutor's account was deleted (tutor_id is
-- on delete set null), which until now went quiet.
--
-- Body copied from the live definition (md5 of prosrc
-- c3419a2494370ec76abace3923fc0d1e on 7 Oct, last written by
-- 20261003100000_chat_retention_gaps). The only change is v_to_team and the
-- insert reading from a set of recipients rather than one.
--
-- Safe before or after the app: the app now live never writes a null tutor_id.

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

  -- chat_thread_id ties the notification to its thread, so it is deleted
  -- with it (M-26).
  insert into public.notifications (user_id, type, title, body, link, chat_thread_id)
  select
    u.id,
    'chat_message',
    case
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
