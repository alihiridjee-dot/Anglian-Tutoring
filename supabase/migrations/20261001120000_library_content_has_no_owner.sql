-- Library sheets and quizzes have no owner.
--
-- A generated homework sheet is one per spec point, shared by every student who
-- reaches that point, and so is a generated quiz set. Both were saved with
-- `created_by` set to whichever student's week happened to ask for them first.
-- On `resources` that column was a foreign key to auth.users ON DELETE CASCADE,
-- so deleting that one student — the account-deletion purge, or a delete in the
-- Supabase dashboard — deleted the sheet, and with it every other student's
-- submission, answers, marks and drafts on it. It also showed students each
-- other's user ids: anyone who may read a sheet or a set may read the column.
--
--   resources.created_by   optional now, and ON DELETE SET NULL. A tutor's own
--                          sheets, sessions and videos keep their author, and
--                          losing the tutor's account no longer deletes them.
--   library rows           generated sheets and sets record no owner, and the
--                          ones already saved are cleared.
--   the two writers        keep their `_created_by` argument, now defaulted and
--                          ignored, so the app and this migration can ship in
--                          either order.
--
-- Idempotent. Rollback: supabase/rollbacks/20261001120000_library_content_has_no_owner.down.sql

begin;

-- ── 1 · resources.created_by never takes the row with it ──────────────────

alter table public.resources alter column created_by drop not null;

-- Declared inline in the July scaffold, so found by column rather than by a
-- generated name that may differ in production.
do $$
declare
  _name text;
begin
  for _name in
    select c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.resources'::regclass
      and c.contype = 'f'
      and a.attname = 'created_by'
  loop
    execute format('alter table public.resources drop constraint %I', _name);
  end loop;
end
$$;

alter table public.resources
  add constraint resources_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

-- ── 2 · Library rows belong to nobody ──────────────────────────────────────

update public.resources
   set created_by = null
 where kind = 'homework' and origin = 'generated' and created_by is not null;

-- mcq_sets.created_by was never a foreign key, so it cascaded nothing; it only
-- exposed the student. Tutor quizzes keep their author.
alter table public.mcq_sets alter column created_by drop not null;

update public.mcq_sets
   set created_by = null
 where origin = 'generated' and created_by is not null;

-- ── 3 · The writers stop recording who asked ───────────────────────────────

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

commit;
