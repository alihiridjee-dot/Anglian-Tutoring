-- Fix-first extras, on top of 20261001104228_fix_first_access_rules.
--
-- Three things that migration left as they were:
--
--   library rows      a shared homework sheet or quiz set still records the
--                     student whose week asked for it first. The cascade is
--                     gone (#1), but the id stays on a row every student in the
--                     subject may read. Library rows now record no owner, and
--                     the ones already saved are cleared. The writers keep their
--                     `_created_by` argument, defaulted and ignored, so the app
--                     and this migration can go live in either order.
--   thread rows       a member could still update their own thread directly:
--                     pin it to the top of every tutor's inbox (last_message_at)
--                     or mark it read for tutors (tutor_last_read_at). Members
--                     never need to: their read state goes through
--                     mark_chat_thread_read() and the bump through the message
--                     trigger, both definer functions. Only tutors update a
--                     thread now.
--   delete / unread   delete_chat_thread() and chat_unread_count() run as
--                     definer, so they don't see the link rule #3 put on the
--                     threads' read policy. An unlinked parent could still
--                     delete the hidden thread, and the history tutors keep with
--                     it, and its messages still counted in their unread badge.
--                     Both now follow the link, as does mark_chat_thread_read().
--
-- Idempotent. Rollback: supabase/rollbacks/20261001150000_fix_first_extras.down.sql

begin;

-- ── 1 · Library rows belong to nobody ──────────────────────────────────────

update public.resources
   set created_by = null
 where kind = 'homework' and origin = 'generated' and created_by is not null;

-- Never a foreign key, so it cascaded nothing; it only exposed the student.
-- Tutor quizzes keep their author.
alter table public.mcq_sets alter column created_by drop not null;

update public.mcq_sets
   set created_by = null
 where origin = 'generated' and created_by is not null;

-- Body unchanged from 20260921221948 apart from the owner: no null check on
-- `_created_by`, and null written in its place.
create or replace function public.ensure_generated_homework(
  _spec_point_id uuid,
  _title text,
  _subject public.subject,
  _level public.level,
  _questions jsonb,
  _created_by uuid default null,
  _board public.board default null,
  _publish_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _resource_id uuid;
begin
  -- `_created_by` is accepted and ignored: a library sheet belongs to nobody.

  -- Already generated, possibly by another student moments ago.
  select r.id into _resource_id
  from public.resources r
  where r.kind = 'homework' and r.spec_point_id = _spec_point_id;
  if _resource_id is not null then
    return _resource_id;
  end if;

  if not exists (select 1 from public.spec_points sp where sp.id = _spec_point_id) then
    raise exception 'Unknown spec point';
  end if;

  if _questions is null or jsonb_array_length(_questions) = 0 then
    raise exception 'Refusing to create a homework with no questions';
  end if;

  insert into public.resources
    (kind, title, subject, board, level, spec_point_id, created_by, origin,
     review_status, publish_at)
  values
    ('homework', _title, _subject, _board, _level, _spec_point_id, null, 'generated',
     'to_review', coalesce(_publish_at, now()))
  on conflict (spec_point_id) where kind = 'homework' and spec_point_id is not null
  do nothing
  returning id into _resource_id;

  -- Lost the race: the winner's sheet is the one everybody uses.
  if _resource_id is null then
    select r.id into _resource_id
    from public.resources r
    where r.kind = 'homework' and r.spec_point_id = _spec_point_id;
    return _resource_id;
  end if;

  insert into public.homework_questions
    (resource_id, position, prompt, marks, answer_type, mark_scheme, spec_point_id)
  select
    _resource_id,
    (t.ord - 1)::int,
    t.q ->> 'prompt',
    greatest(1, least(30, coalesce((t.q ->> 'marks')::int, 2))),
    case when t.q ->> 'answer_type' in ('short', 'long', 'numeric')
         then t.q ->> 'answer_type' else 'short' end,
    nullif(btrim(coalesce(t.q ->> 'mark_scheme', '')), ''),
    _spec_point_id
  from jsonb_array_elements(_questions) with ordinality as t(q, ord)
  where nullif(btrim(coalesce(t.q ->> 'prompt', '')), '') is not null;

  insert into public.resource_spec_points (resource_id, spec_point_id)
  values (_resource_id, _spec_point_id)
  on conflict do nothing;

  return _resource_id;
end;
$$;

revoke all on function public.ensure_generated_homework(
  uuid, text, public.subject, public.level, jsonb, uuid, public.board, timestamptz
) from public, anon, authenticated;
grant execute on function public.ensure_generated_homework(
  uuid, text, public.subject, public.level, jsonb, uuid, public.board, timestamptz
) to service_role;

-- Body unchanged from 20260916140000 apart from the owner, as above.
create or replace function public.ensure_generated_mcq_set(
  _spec_point_id uuid,
  _questions jsonb,
  _created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _set_id uuid;
  _title text;
  _subject public.subject;
begin
  -- `_created_by` is accepted and ignored: a library quiz belongs to nobody.

  -- Already generated, possibly by another student moments ago. With no
  -- questions this is only a lookup, and says so by returning null.
  select s.id into _set_id
  from public.mcq_sets s
  where s.origin = 'generated' and s.spec_point_id = _spec_point_id;
  if _set_id is not null or _questions is null then
    return _set_id;
  end if;

  select sp.code || ' ' || sp.title, t.subject
    into _title, _subject
  from public.spec_points sp
  join public.topics t on t.id = sp.topic_id
  where sp.id = _spec_point_id;
  if _title is null then
    raise exception 'Unknown spec point';
  end if;

  if jsonb_typeof(_questions) is distinct from 'array' or jsonb_array_length(_questions) = 0 then
    raise exception 'Refusing to create a quiz with no questions';
  end if;

  if exists (
    select 1 from jsonb_array_elements(_questions) q
    where nullif(btrim(coalesce(q ->> 'question', '')), '') is null
       or jsonb_typeof(q -> 'options') is distinct from 'array'
       or jsonb_array_length(q -> 'options') <> 4
       or jsonb_typeof(q -> 'correct_index') is distinct from 'number'
       or (q ->> 'correct_index')::numeric not in (0, 1, 2, 3)
  ) then
    raise exception 'A question is missing its text, four options or a valid answer';
  end if;

  insert into public.mcq_sets
    (spec_point_id, title, description, published, subject, created_by, origin)
  values
    (_spec_point_id, _title, 'Practice questions for this spec point', true, _subject, null,
     'generated')
  on conflict (spec_point_id) where origin = 'generated' and spec_point_id is not null
  do nothing
  returning id into _set_id;

  -- Lost the race: the winner's set is the one everybody uses.
  if _set_id is null then
    select s.id into _set_id
    from public.mcq_sets s
    where s.origin = 'generated' and s.spec_point_id = _spec_point_id;
    return _set_id;
  end if;

  insert into public.mcq_questions
    (set_id, position, question, options, correct_index, explanation, spec_point_id)
  select
    _set_id,
    (t.ord - 1)::int,
    btrim(t.q ->> 'question'),
    t.q -> 'options',
    (t.q ->> 'correct_index')::int,
    nullif(btrim(coalesce(t.q ->> 'explanation', '')), ''),
    _spec_point_id
  from jsonb_array_elements(_questions) with ordinality as t(q, ord);

  return _set_id;
end;
$$;

revoke all on function public.ensure_generated_mcq_set(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.ensure_generated_mcq_set(uuid, jsonb, uuid) to service_role;

-- ── 2 · Only tutors update a thread ────────────────────────────────────────

drop policy if exists "chat_threads participants update" on public.chat_threads;
drop policy if exists "chat_threads tutors update" on public.chat_threads;
create policy "chat_threads tutors update" on public.chat_threads
  for update to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::public.app_role))
  with check (private.has_role((select auth.uid()), 'tutor'::public.app_role));

-- ── 3 · The chat definer functions follow the link ─────────────────────────

-- The same member rule as the threads' read policy from 20261001104228: the
-- caller is the thread's member and, on a parent's thread, still linked to
-- the child. Answers only for the caller.
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

-- As 20260916120000; the member must still be able to see the thread.
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

commit;
