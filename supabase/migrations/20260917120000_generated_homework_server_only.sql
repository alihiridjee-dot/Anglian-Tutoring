-- Only the app server may write library homework.
--
-- `ensure_generated_homework` is SECURITY DEFINER and was executable by any
-- signed-in user. That is what makes it useful — the caller is the student whose
-- week needs the sheet, and setting homework otherwise needs the tutor role —
-- but it also meant a student could call it directly with questions and mark
-- schemes of their own. One sheet exists per spec point and every student who
-- reaches that point reads it, so a single hand-rolled request could put chosen
-- content, or a wrong mark scheme, in front of a whole cohort. The mark scheme
-- matters most: marking reads it, so a forged one changes what other children
-- are told they got right.
--
-- The shared MCQ writer was built this way from the start
-- (`ensure_generated_mcq_set`); this brings homework in line. The server passes
-- the signed-in user it acted for, so `created_by` still names a real person.
--
-- The generator is the only caller, and it already holds the service credential
-- for retrieving exemplars, so nothing else has to change.

drop function if exists public.ensure_generated_homework(uuid, text, public.subject, public.level, jsonb, public.board);

create function public.ensure_generated_homework(
  _spec_point_id uuid,
  _title text,
  _subject public.subject,
  _level public.level,
  _questions jsonb,
  _created_by uuid,
  _board public.board default null
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
    (kind, title, subject, board, level, spec_point_id, created_by, origin)
  values
    ('homework', _title, _subject, _board, _level, _spec_point_id, _created_by, 'generated')
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
  uuid, text, public.subject, public.level, jsonb, uuid, public.board
) from public, anon, authenticated;
grant execute on function public.ensure_generated_homework(
  uuid, text, public.subject, public.level, jsonb, uuid, public.board
) to service_role;

-- The generator writes through the service credential, which bypasses RLS, but
-- `resources` and `homework_questions` are read by everyone through it, so the
-- grants stay as they are: this changes who may call the writer, nothing else.
