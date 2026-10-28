-- Size limits and flood limits (28 Oct 2026).
--
-- Nothing a student or parent typed had a length limit, and nothing limited
-- how fast new conversations and messages could be sent.
--
-- 1. Length caps. Each one is far above anything real, so no genuine answer
--    is ever cut off. Largest live value on 28 Oct in brackets:
--      task answer                5,000 characters (390; a 6-mark answer is ~2,000)
--      draft answer               5,000 each, at most 50 in one draft (274, 4)
--      draft edit times          10,000 bytes (232)
--      task note / draft note     2,000 (none: the sheet has no note box now)
--      chat message               4,000 (an AI-drafted reply is under 500 tokens)
--      chat subject line            200 (the form stops at 140)
--      chat context label           300 (the longest a picker makes is 107)
--      display name                  80 (19)
--      phone                         32 (15)
--      school                       120 (33; the longest UK school name is 83)
--      weekly check-in note       2,000 (74)
--    The forms stop at the same numbers (src/lib/platform/textLimits.ts, whose
--    test reads this file), so a student never meets the database's refusal.
--    submit_homework_answers says in plain words when an answer is too long.
--    handle_new_user clips a name (or phone) brought by a sign-up to fit, so
--    a long Google or Microsoft name can never stop an account being made.
--
-- 2. Flood limits: a student or parent may start 10 conversations a day and
--    send 30 messages an hour. Tutors are not limited. A refused send says
--    why. Counted in ai_request_log, the per-user counter claim_ai_request
--    keeps (same lock, same nightly prune), by a private helper rather than
--    a new row in claim_ai_request's list: PR #311 replaces that function
--    too, and two copies of its list would undo each other.
--
-- 3. Chat times, read marks and status are the server's. The app's role
--    inserts only the columns the app sends; the rest come from their
--    defaults and the message trigger. Only a tutor's message keeps the
--    AI-drafted mark.
--
-- 4. A draft row only for a task the student can open. (sync_homework_draft
--    itself is left alone: PR #315 replaces it.)
--
-- 5. An answer made only of spaces or invisible characters is stored as
--    blank, so it shows as "Left blank" and is marked as one (T-11).
--
-- Replaced functions are the live bodies of 28 Oct (md5 of prosrc:
-- submit_homework_answers 6119c6adaefa5ea77a5dc9f720633172, handle_new_user
-- 588cdbda93d4c21afff5601ffe54cbad) with only the changes above. Same
-- signatures, security and search_path, so their grants carry over.
-- Idempotent.
--
-- Rollback: supabase/rollbacks/20261028110000_size_and_flood_limits.down.sql
-- Test: scripts/test-size-and-flood-limits-db.ts


-- ── 1. Length caps ───────────────────────────────────────────────────────────

-- Every answer in a draft is a string of at most 5,000 characters, and a
-- draft holds at most 50 of them. A function because a check can't hold a
-- subquery; the app's role needs EXECUTE because a check runs as the writer.
create or replace function private.homework_draft_answers_fit(_answers jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(_answers) = 'object'
     and (select count(*) from jsonb_object_keys(_answers)) <= 50
     and not exists (
       select 1
       from jsonb_each(_answers) e
       where jsonb_typeof(e.value) <> 'string'
          or char_length(e.value #>> '{}') > 5000
     );
$$;
revoke all on function private.homework_draft_answers_fit(jsonb) from public, anon;
grant execute on function private.homework_draft_answers_fit(jsonb) to authenticated, service_role;

alter table public.homework_answers drop constraint if exists homework_answers_answer_text_length;
alter table public.homework_answers add constraint homework_answers_answer_text_length
  check (char_length(answer_text) <= 5000);

alter table public.homework_submissions drop constraint if exists homework_submissions_notes_length;
alter table public.homework_submissions add constraint homework_submissions_notes_length
  check (char_length(notes) <= 2000);

alter table public.homework_drafts drop constraint if exists homework_drafts_answers_fit;
alter table public.homework_drafts add constraint homework_drafts_answers_fit
  check (private.homework_draft_answers_fit(answers));
alter table public.homework_drafts drop constraint if exists homework_drafts_notes_length;
alter table public.homework_drafts add constraint homework_drafts_notes_length
  check (char_length(notes) <= 2000);
alter table public.homework_drafts drop constraint if exists homework_drafts_stamps_size;
alter table public.homework_drafts add constraint homework_drafts_stamps_size
  check (octet_length(stamps::text) <= 10000);

alter table public.chat_messages drop constraint if exists chat_messages_body_length;
alter table public.chat_messages add constraint chat_messages_body_length
  check (char_length(body) <= 4000);

alter table public.chat_threads drop constraint if exists chat_threads_subject_line_length;
alter table public.chat_threads add constraint chat_threads_subject_line_length
  check (char_length(subject_line) <= 200);
alter table public.chat_threads drop constraint if exists chat_threads_context_label_length;
alter table public.chat_threads add constraint chat_threads_context_label_length
  check (char_length(context_label) <= 300);

alter table public.profiles drop constraint if exists profiles_display_name_length;
alter table public.profiles add constraint profiles_display_name_length
  check (char_length(display_name) <= 80);
alter table public.profiles drop constraint if exists profiles_phone_length;
alter table public.profiles add constraint profiles_phone_length
  check (char_length(phone) <= 32);
alter table public.profiles drop constraint if exists profiles_school_length;
alter table public.profiles add constraint profiles_school_length
  check (char_length(school) <= 120);

alter table public.student_weekly_checkins drop constraint if exists student_weekly_checkins_reflection_length;
alter table public.student_weekly_checkins add constraint student_weekly_checkins_reflection_length
  check (char_length(reflection) <= 2000);

-- A sign-up's name (ours, or the one Google or Microsoft sends) and phone are
-- clipped to fit, so the caps above can never stop an account being made.
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  meta_role text;
  final_role public.profile_role;
  v_code text := upper(btrim(coalesce(NEW.raw_user_meta_data->>'parent_invite_code', '')));
  v_student uuid;
  v_parent_name text;
begin
  meta_role := lower(coalesce(NEW.raw_user_meta_data->>'role', 'student'));

  -- Self-declared identity, and nothing more. 'tutor' is deliberately absent:
  -- an unrecognised value falls back to 'student' rather than being honoured.
  final_role := case
    when meta_role in ('student', 'parent') then meta_role::public.profile_role
    else 'student'::public.profile_role
  end;

  insert into public.profiles (id, display_name, role, phone)
  values (
    NEW.id,
    -- Our form's name first, then the name a Google / Microsoft sign-up brings.
    -- Clipped to profiles_display_name_length.
    left(coalesce(
      nullif(btrim(NEW.raw_user_meta_data->>'display_name'), ''),
      nullif(btrim(NEW.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(NEW.raw_user_meta_data->>'name'), ''),
      split_part(NEW.email, '@', 1)
    ), 80),
    final_role,
    left(NEW.raw_user_meta_data->>'phone', 32)
  );

  if lower(NEW.email) = 'asa180@live.co.uk' then
    insert into public.user_roles (user_id, role) values (NEW.id, 'tutor')
    on conflict do nothing;
    update public.profiles set role = 'tutor' where id = NEW.id;
  else
    insert into public.user_roles (user_id, role) values (NEW.id, 'student')
    on conflict do nothing;
  end if;

  -- A parent who signs up with their child's invite code is linked by the
  -- rules link_child_by_code uses later on: the code trimmed and upper-cased,
  -- only a student's code counts, a repeat is a no-op, and the child is told,
  -- so an unexpected link is visible rather than silent.
  if final_role = 'parent' and v_code <> '' then
    select p.id into v_student
    from public.profiles p
    where p.student_invite_code = v_code
      and p.role = 'student'::public.profile_role;

    if v_student is not null then
      insert into public.parent_student_links (parent_id, student_id)
      values (NEW.id, v_student)
      on conflict (parent_id, student_id) do nothing;

      select coalesce(nullif(btrim(p.display_name), ''), 'Your parent/guardian')
        into v_parent_name
      from public.profiles p where p.id = NEW.id;

      insert into public.notifications (user_id, type, title, body, link)
      values (
        v_student, 'parent_invite', 'Parent linked to your account',
        v_parent_name || ' linked to your account using your invite code.', '/parents'
      );
    end if;
  end if;

  return NEW;
end;
$function$;


-- ── 2. Flood limits ──────────────────────────────────────────────────────────

-- claim_ai_request's counter for chat sends: the same lock key and log, so
-- one user's sends are counted one at a time, and the nightly prune of
-- ai_request_log (anything over a day old) keeps it small. Called only by the
-- two guards below, never by the app.
create or replace function private.claim_chat_send(_endpoint text, _max integer, _period interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _used int;
begin
  -- One claim at a time per user and endpoint; released at commit.
  perform pg_advisory_xact_lock(hashtextextended('claim_ai_request:' || _uid || ':' || _endpoint, 0));

  select count(*) into _used
  from public.ai_request_log
  where user_id = _uid
    and endpoint = _endpoint
    and created_at > now() - _period;

  if _used >= _max then
    return false;
  end if;

  insert into public.ai_request_log (user_id, endpoint) values (_uid, _endpoint);
  return true;
end
$$;
revoke all on function private.claim_chat_send(text, integer, interval) from public, anon, authenticated;

-- A new conversation from a student or parent counts against chat_thread.
-- Only signed-in callers: server-side writers have no auth.uid().
create or replace function private.chat_thread_flood_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.has_role(auth.uid(), 'tutor'::public.app_role) then
    return new;
  end if;
  if not private.claim_chat_send('chat_thread', 10, interval '1 day') then
    raise exception 'You''ve started a lot of conversations today. Add to one you already have, or start a new one tomorrow.';
  end if;
  return new;
end
$$;
revoke all on function private.chat_thread_flood_guard() from public, anon, authenticated;

drop trigger if exists chat_thread_flood_guard on public.chat_threads;
create trigger chat_thread_flood_guard
  before insert on public.chat_threads
  for each row execute function private.chat_thread_flood_guard();

-- A message from a student or parent counts against chat_message, and only a
-- tutor's message keeps the AI-drafted mark.
create or replace function private.chat_message_flood_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.has_role(auth.uid(), 'tutor'::public.app_role) then
    return new;
  end if;
  new.ai_drafted := false;
  if not private.claim_chat_send('chat_message', 30, interval '1 hour') then
    raise exception 'You''ve sent a lot of messages in the last hour. Wait a little, then send this one again.';
  end if;
  return new;
end
$$;
revoke all on function private.chat_message_flood_guard() from public, anon, authenticated;

drop trigger if exists chat_message_flood_guard on public.chat_messages;
create trigger chat_message_flood_guard
  before insert on public.chat_messages
  for each row execute function private.chat_message_flood_guard();


-- ── 3. Chat columns the app may write ────────────────────────────────────────
-- Exactly what ChatDAL.startThread and ChatDAL.sendMessage send. Revoking the
-- table-wide grant also drops its column grants, so the grants below are all
-- that is left.

revoke insert on table public.chat_threads from anon, authenticated;
grant insert (student_id, tutor_id, about_student_id, subject, spec_point_id, resource_id,
              mcq_set_id, subject_line, context_label)
  on table public.chat_threads to authenticated;

revoke insert on table public.chat_messages from anon, authenticated;
grant insert (thread_id, sender_id, body, ai_drafted)
  on table public.chat_messages to authenticated;


-- ── 4. Drafts only for tasks the student can open ────────────────────────────
-- The resources policy decides what "can open" means: the subquery runs under
-- the caller's own row rules. Restrictive, so "hd own" still applies too.

drop policy if exists "hd open tasks only" on public.homework_drafts;
create policy "hd open tasks only" on public.homework_drafts
  as restrictive for insert to authenticated
  with check (exists (
    select 1 from public.resources r
    where r.id = homework_drafts.resource_id and r.kind = 'homework'
  ));
drop policy if exists "hd open tasks only on update" on public.homework_drafts;
create policy "hd open tasks only on update" on public.homework_drafts
  as restrictive for update to authenticated
  using (exists (
    select 1 from public.resources r
    where r.id = homework_drafts.resource_id and r.kind = 'homework'
  ))
  with check (exists (
    select 1 from public.resources r
    where r.id = homework_drafts.resource_id and r.kind = 'homework'
  ));


-- ── 5. Hand-in: answers too long are refused; invisible-only answers blank ──
-- The live body; the changes are the length check and how a blank is found.
create or replace function public.submit_homework_answers(_resource_id uuid, _answers jsonb, _notes text DEFAULT NULL::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _uid uuid := auth.uid();
  _submission_id uuid;
begin
  if _uid is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1 from public.resources r where r.id = _resource_id and r.kind = 'homework'
  ) then
    raise exception 'That task does not exist';
  end if;

  -- The resources policy's rule, for the caller (see the header).
  if not exists (
    select 1 from public.resources r
    where r.id = _resource_id
      and (
        private.has_role(_uid, 'tutor'::public.app_role)
        or (
          r.subject::text = any (private.student_paid_subjects(_uid))
          and (
            r.review_status = 'approved'
            or (r.review_status = 'to_review' and (r.publish_at is null or r.publish_at <= now()))
          )
        )
      )
  ) then
    raise exception 'That task is not open to you';
  end if;

  if exists (
    select 1 from public.homework_submissions s
    where s.resource_id = _resource_id and s.student_id = _uid
  ) then
    raise exception 'You have already submitted this task';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a
    where not exists (
      select 1 from public.homework_questions q
      where q.id = (a ->> 'question_id')::uuid and q.resource_id = _resource_id
    )
  ) then
    raise exception 'An answer refers to a question that is not on this task';
  end if;

  -- The same limit as homework_answers_answer_text_length, in words a
  -- student can act on.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a
    where char_length(btrim(coalesce(a ->> 'answer_text', ''))) > 5000
  ) then
    raise exception 'One of your answers is too long. Each answer can be up to 5,000 characters.';
  end if;

  insert into public.homework_submissions (resource_id, student_id, notes, submitted_at)
  values (_resource_id, _uid, nullif(btrim(coalesce(_notes, '')), ''), now())
  returning id into _submission_id;

  -- Blank is nothing a reader can see: spaces, line breaks and invisible
  -- formatting characters (zero-width spaces, direction marks) only.
  insert into public.homework_answers (submission_id, question_id, answer_text)
  select
    _submission_id,
    (a ->> 'question_id')::uuid,
    case
      when regexp_replace(
             coalesce(a ->> 'answer_text', ''),
             '[\s\u00a0\u00ad\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]',
             '', 'g') = '' then null
      else btrim(a ->> 'answer_text')
    end
  from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a;

  delete from public.homework_drafts
   where student_id = _uid and resource_id = _resource_id;

  return _submission_id;
end;
$function$;
