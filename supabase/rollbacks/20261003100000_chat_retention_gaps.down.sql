-- Rollback for 20261003100000_chat_retention_gaps.sql. Run by hand.
--
-- Restores the three function bodies as they were live on 3 Oct 2026, drops
-- notifications.chat_thread_id, and puts sender_id back to NOT NULL + CASCADE.
-- That last step fails while a deleted tutor's reply (sender_id null) exists:
-- decide first whether to delete those replies (the old behaviour) or keep
-- the column nullable and skip the last block.

create or replace function public.expire_stale_chat_threads()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _deleted integer;
begin
  delete from chat_threads t
  where t.last_message_at < now() - interval '30 days'
    and exists (
      select 1
      from chat_messages m
      where m.thread_id = t.id
        and m.sender_id = t.tutor_id
    );
  get diagnostics _deleted = row_count;
  return _deleted;
end
$function$;

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
    and m.sender_id <> (select auth.uid())
    and (
      (private.chat_member_can_see(t.student_id, t.about_student_id)
        and m.created_at > coalesce(t.student_last_read_at, '-infinity'::timestamptz))
      or (private.has_role((select auth.uid()), 'tutor'::public.app_role)
        and t.student_id <> (select auth.uid())
        and m.created_at > coalesce(t.tutor_last_read_at, '-infinity'::timestamptz))
    )
$function$;

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

  if v_from_student and not exists (
    select 1 from public.user_roles r
    where r.user_id = v_recipient and r.role = 'tutor'::public.app_role
  ) then
    return new;
  end if;

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

drop index if exists public.notifications_chat_thread_id_idx;
alter table public.notifications drop column if exists chat_thread_id;

comment on column public.chat_messages.sender_id is null;
alter table public.chat_messages drop constraint if exists chat_messages_sender_id_fkey;
alter table public.chat_messages
  add constraint chat_messages_sender_id_fkey
  foreign key (sender_id) references public.profiles(id) on delete cascade;
alter table public.chat_messages alter column sender_id set not null;
