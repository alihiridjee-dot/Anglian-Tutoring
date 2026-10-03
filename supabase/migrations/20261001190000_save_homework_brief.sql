-- S-11 and M-20: a homework brief is saved in one transaction.
--
-- S-11. HomeworkForm saved each question's new position in its own request,
-- and unique (resource_id, position) is not deferrable, so swapping two
-- questions failed every time (23505). Deleting a middle question failed some
-- of the time, after the title change and the delete (which also deletes the
-- students' answers to it) had already been saved.
--
-- M-20. Creating a brief inserted the resource, then its questions. If the
-- second write failed, students saw an empty brief with a due date, and
-- pressing "Set homework" again made a second one.
--
-- This writes the brief, its questions and its spec-point links together, or
-- nothing. Kept questions are parked on negative positions first, so no order
-- of moves can collide. Security invoker: row-level security still decides
-- who may write (tutors only), exactly as for the requests it replaces. It
-- never reads mark_scheme, which browsers can't select since #88.
--
-- _questions is the sheet in order: [{id?, prompt, marks, answer_type,
-- mark_scheme, spec_point_id}]. A question with an id is updated in place, so
-- the answers pointing at it stay; one without is added; a question on the
-- sheet that isn't in the list is deleted, with its answers.
create or replace function public.save_homework_brief(
  _id uuid,
  _title text,
  _instructions text,
  _due_at timestamptz,
  _subject public.subject,
  _board public.board,
  _level public.level,
  _spec_point_ids uuid[],
  _questions jsonb
)
 returns uuid
 language plpgsql
 security invoker
 set search_path to ''
as $function$
declare
  _rid uuid;
  _kept uuid[];
  _q jsonb;
  _pos int;
  _qid uuid;
begin
  _questions := coalesce(_questions, '[]'::jsonb);
  if jsonb_typeof(_questions) <> 'array' then
    raise exception 'Questions must be a list';
  end if;

  _kept := array(
    select (e->>'id')::uuid
    from jsonb_array_elements(_questions) e
    where nullif(e->>'id', '') is not null
  );
  if cardinality(_kept) <> (select count(distinct k) from unnest(_kept) k) then
    raise exception 'A question appears twice';
  end if;

  if _id is null then
    insert into public.resources(
      kind, title, instructions, due_at, subject, board, level, created_by, origin
    )
    values (
      'homework'::public.resource_kind, _title, _instructions, _due_at,
      _subject, _board, _level, (select auth.uid()),
      -- A brief written here is one somebody decided to set, which is what
      -- separates it from the generated library in the student's list.
      'tutor'::public.resource_origin
    )
    returning id into _rid;
  else
    -- Also locks the brief, so two saves of it run one after the other.
    update public.resources
       set title = _title,
           instructions = _instructions,
           due_at = _due_at,
           subject = _subject,
           board = _board,
           level = _level
     where id = _id
       and kind = 'homework'::public.resource_kind
    returning id into _rid;
    if _rid is null then
      raise exception 'This homework no longer exists.' using errcode = 'P0002';
    end if;
  end if;

  delete from public.homework_questions
   where resource_id = _rid
     and id <> all(_kept);

  update public.homework_questions
     set position = -1 - position
   where resource_id = _rid;

  for _q, _pos in
    select e.value, (e.ordinality - 1)::int
    from jsonb_array_elements(_questions) with ordinality as e(value, ordinality)
  loop
    if coalesce(btrim(_q->>'prompt'), '') = '' then
      raise exception 'Every question needs a prompt.';
    end if;
    _qid := nullif(_q->>'id', '')::uuid;

    if _qid is null then
      insert into public.homework_questions(
        resource_id, position, prompt, marks, answer_type, mark_scheme, spec_point_id
      )
      values (
        _rid, _pos, btrim(_q->>'prompt'), (_q->>'marks')::int,
        coalesce(_q->>'answer_type', 'short'),
        nullif(btrim(_q->>'mark_scheme'), ''),
        nullif(_q->>'spec_point_id', '')::uuid
      );
    else
      update public.homework_questions
         set position = _pos,
             prompt = btrim(_q->>'prompt'),
             marks = (_q->>'marks')::int,
             answer_type = coalesce(_q->>'answer_type', 'short'),
             mark_scheme = nullif(btrim(_q->>'mark_scheme'), ''),
             spec_point_id = nullif(_q->>'spec_point_id', '')::uuid
       where id = _qid
         and resource_id = _rid;
      if not found then
        raise exception 'A question on this homework was removed while you were editing it. Close it and open it again.'
          using errcode = 'P0002';
      end if;
    end if;
  end loop;

  -- Curriculum links: links that stay keep their row.
  delete from public.resource_spec_points
   where resource_id = _rid
     and spec_point_id <> all(coalesce(_spec_point_ids, '{}'::uuid[]));
  insert into public.resource_spec_points(resource_id, spec_point_id)
  select distinct _rid, p
  from unnest(coalesce(_spec_point_ids, '{}'::uuid[])) as p
  on conflict do nothing;

  return _rid;
end;
$function$;

revoke all on function public.save_homework_brief(
  uuid, text, text, timestamptz, public.subject, public.board, public.level, uuid[], jsonb
) from public;
revoke all on function public.save_homework_brief(
  uuid, text, text, timestamptz, public.subject, public.board, public.level, uuid[], jsonb
) from anon;
grant execute on function public.save_homework_brief(
  uuid, text, text, timestamptz, public.subject, public.board, public.level, uuid[], jsonb
) to authenticated;
