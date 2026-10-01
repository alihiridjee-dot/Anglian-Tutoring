-- DOWN for migrations/20261001150000_fix_first_extras.sql.
--
-- Kept out of supabase/migrations on purpose: the CLI applies everything in
-- that folder, in order, and a rollback must only ever run by hand.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -f supabase/rollbacks/20261001150000_fix_first_extras.down.sql
--
-- Puts back the update policy from 20261001104228, the chat functions as their
-- own migrations defined them, and writers that require and record the caller.
--
-- Not restored: the owners that were cleared from library rows, which are
-- gone, and NOT NULL on mcq_sets.created_by, which cannot return while library
-- quizzes have no owner.

begin;

-- ── Writers that record the caller again ───────────────────────────────────
-- A default cannot be taken off with create or replace, so drop and recreate.
drop function if exists public.ensure_generated_homework(
  uuid, text, public.subject, public.level, jsonb, uuid, public.board, timestamptz
);

create function public.ensure_generated_homework(
  _spec_point_id uuid,
  _title text,
  _subject public.subject,
  _level public.level,
  _questions jsonb,
  _created_by uuid,
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
  if _created_by is null then
    raise exception 'A generated homework needs the user it was made for';
  end if;

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
    ('homework', _title, _subject, _board, _level, _spec_point_id, _created_by, 'generated',
     'to_review', coalesce(_publish_at, now()))
  on conflict (spec_point_id) where kind = 'homework' and spec_point_id is not null
  do nothing
  returning id into _resource_id;

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

drop function if exists public.ensure_generated_mcq_set(uuid, jsonb, uuid);

create function public.ensure_generated_mcq_set(
  _spec_point_id uuid,
  _questions jsonb,
  _created_by uuid
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
  if _created_by is null then
    raise exception 'A generated quiz needs the user it was made for';
  end if;

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
    (_spec_point_id, _title, 'Practice questions for this spec point', true, _subject, _created_by,
     'generated')
  on conflict (spec_point_id) where origin = 'generated' and spec_point_id is not null
  do nothing
  returning id into _set_id;

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

-- ── The update policy as 20261001104228 left it ────────────────────────────
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
      and (tutor_id is null or tutor_id in (select d.id from public.tutor_directory() d))
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

-- ── The chat functions as 20260916120000 and 20260803231700 left them ──────
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

drop function if exists private.chat_member_can_see(uuid, uuid);

commit;
