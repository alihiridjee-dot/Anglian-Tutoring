-- Parent ↔ tutor messaging.
--
-- A chat thread has one non-staff member, `student_id`, and every rule around
-- it (read, send, mark read, delete, unread count) is written against that
-- column rather than against the student role. A parent's conversation reuses
-- all of it by being that member, and says which child it is about in
-- `about_student_id`. That column is what lets a tutor see "parent of Alex"
-- and find the thread on Alex's record.
--
-- Nothing is widened. A parent still reads only threads they are the member of,
-- so they never see their child's conversations, and a child never sees their
-- parent's. What changes is who may *create* one: naming a child requires a
-- link to that child.

alter table public.chat_threads
  add column if not exists about_student_id uuid
    references public.profiles (id) on delete cascade;

comment on column public.chat_threads.about_student_id is
  'Set on a parent''s thread: the linked child it is about. Null on a student''s own thread.';

create index if not exists chat_threads_about_student_id_idx
  on public.chat_threads (about_student_id)
  where about_student_id is not null;

-- Who may open a thread. A student opens their own with no child named; a
-- parent must name a child they are linked to. Staff do not open threads.
drop policy if exists "chat_threads student creates own" on public.chat_threads;
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

-- The update policy let a member rewrite any column of their own thread. The
-- app never does (read state goes through mark_chat_thread_read), but left as
-- it was a parent could repoint a thread at a child who isn't theirs.
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

-- The fan-out trigger, unchanged except for who it is talking to. A reply to a
-- parent links to the Parent Portal, because /messages is a student section
-- and bounces them; and a parent's message isn't a "question".
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
