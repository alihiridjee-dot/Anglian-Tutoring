-- Student ↔ tutor messaging.
--
-- A thread is one question. It names the tutor it was addressed to, and may be
-- pinned to exactly one piece of context the student was looking at when they
-- asked — a spec point, a homework, or a quiz. Context is thread-level rather
-- than message-level because a question is *about* something; scattering it per
-- message would let one conversation drift across three subjects with no way to
-- route it.
--
-- Any tutor may read and answer any thread: tutors are staff and already read
-- across every subject elsewhere in this schema, and a question addressed to one
-- tutor who is away must not sit unanswered. `tutor_id` records who it was meant
-- for, which is what the student chose and what the inbox sorts by.
--
-- Not gated on a live subscription, deliberately. Messaging is an own-records
-- surface like submissions and confidence, which a lapsed student keeps — a
-- family whose plan has stopped is exactly who needs to be able to ask why.

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  -- The tutor the student picked. Kept on delete set null so losing a staff
  -- account never destroys a family's message history.
  tutor_id uuid references public.profiles(id) on delete set null,
  subject public.subject,
  -- At most one of these three: what the question is about.
  spec_point_id uuid references public.spec_points(id) on delete set null,
  resource_id   uuid references public.resources(id)   on delete set null,
  mcq_set_id    uuid references public.mcq_sets(id)    on delete set null,
  subject_line text not null,
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  -- Read watermarks, one per side. Unread = messages after your watermark that
  -- you did not send, which needs no per-recipient row and cannot drift.
  student_last_read_at timestamptz,
  tutor_last_read_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint chat_threads_single_context check (
    (case when spec_point_id is not null then 1 else 0 end)
  + (case when resource_id   is not null then 1 else 0 end)
  + (case when mcq_set_id    is not null then 1 else 0 end) <= 1
  )
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0),
  -- True when the tutor sent a reply that started life as an AI draft. Kept so
  -- the quality of prefilled answers can be reviewed later; never shown to the
  -- student, who is talking to their tutor either way.
  ai_drafted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists chat_threads_student_idx on public.chat_threads (student_id, last_message_at desc);
create index if not exists chat_threads_tutor_idx   on public.chat_threads (tutor_id, last_message_at desc);
create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, created_at);

alter table public.chat_threads  enable row level security;
alter table public.chat_messages enable row level security;

-- ---------------------------------------------------------------- threads ---
create policy "chat_threads read own or tutor"
  on public.chat_threads for select
  using (
    student_id = (select auth.uid())
    or private.has_role((select auth.uid()), 'tutor'::public.app_role)
  );

-- Students start conversations; a tutor replying into an existing thread is an
-- INSERT on chat_messages, not on chat_threads.
create policy "chat_threads student creates own"
  on public.chat_threads for insert
  with check (student_id = (select auth.uid()));

-- Both sides update the same row, but only ever their own side of it: the
-- column-level split is enforced by mark_chat_thread_read(), not here.
create policy "chat_threads participants update"
  on public.chat_threads for update
  using (
    student_id = (select auth.uid())
    or private.has_role((select auth.uid()), 'tutor'::public.app_role)
  )
  with check (
    student_id = (select auth.uid())
    or private.has_role((select auth.uid()), 'tutor'::public.app_role)
  );

-- --------------------------------------------------------------- messages ---
create policy "chat_messages read participants"
  on public.chat_messages for select
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

-- You may only send as yourself, and only into a thread you are part of.
create policy "chat_messages send as self"
  on public.chat_messages for insert
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

-- Messages are a record of what was said: no UPDATE or DELETE policy, so
-- neither side can rewrite history.

-- ------------------------------------------------- fan-out on a new message --
-- Bumps the thread and notifies the OTHER party. SECURITY DEFINER because
-- public.notifications has no INSERT policy at all — every notification in this
-- schema is written by a trigger or an RPC, never by a client.
create or replace function public.on_chat_message_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_thread public.chat_threads%rowtype;
  v_from_student boolean;
  v_recipient uuid;
  v_sender_name text;
begin
  select * into v_thread from public.chat_threads where id = new.thread_id;
  if not found then return new; end if;

  v_from_student := (new.sender_id = v_thread.student_id);
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

  select coalesce(nullif(btrim(p.display_name), ''), 'Your ' ||
           case when v_from_student then 'student' else 'tutor' end)
    into v_sender_name
    from public.profiles p where p.id = new.sender_id;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_recipient,
    'chat_message',
    case when v_from_student
         then v_sender_name || ' sent you a question'
         else 'Reply from ' || v_sender_name end,
    left(new.body, 140),
    '/messages'
  );

  return new;
end;
$$;

drop trigger if exists chat_message_fanout on public.chat_messages;
create trigger chat_message_fanout
  after insert on public.chat_messages
  for each row execute function public.on_chat_message_insert();
