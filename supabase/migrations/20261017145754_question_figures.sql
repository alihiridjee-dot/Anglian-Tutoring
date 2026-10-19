-- Question figures: the picture a question is answered from (a graph, a bar
-- chart, a circuit, a reaction profile, a food web), drawn and checked by the
-- practice queue's worker before the question is saved (src/lib/figures).
--
--   figure        { svg, alt }: what a student's page reads. The svg is the
--                 checker's own rebuilt drawing, and the page checks it again
--                 before showing it.
--   figure_brief  { brief, drawn_by }: what the server keeps. A brief can
--                 hold the answer (a reaction profile's says which arrow is
--                 which), so students get no grant on it.
--
-- A question without a figure has neither. The two writers below take them
-- from the worker's payload; nothing else writes them.

alter table public.mcq_questions
  add column figure jsonb,
  add column figure_brief jsonb;
alter table public.homework_questions
  add column figure jsonb,
  add column figure_brief jsonb;

alter table public.mcq_questions
  add constraint mcq_questions_figure_shape check (
    -- "is not distinct from": a missing part is false, not unknown, which a
    -- check would let through.
    figure is null or (
      jsonb_typeof(figure) = 'object'
      and jsonb_typeof(figure -> 'svg') is not distinct from 'string'
      and jsonb_typeof(figure -> 'alt') is not distinct from 'string'
      and length(figure ->> 'svg') between 1 and 24000
      and length(figure ->> 'alt') between 1 and 2000
    )
  );
alter table public.homework_questions
  add constraint homework_questions_figure_shape check (
    -- "is not distinct from": a missing part is false, not unknown, which a
    -- check would let through.
    figure is null or (
      jsonb_typeof(figure) = 'object'
      and jsonb_typeof(figure -> 'svg') is not distinct from 'string'
      and jsonb_typeof(figure -> 'alt') is not distinct from 'string'
      and length(figure ->> 'svg') between 1 and 24000
      and length(figure ->> 'alt') between 1 and 2000
    )
  );

-- Students read questions column by column; the figure joins the columns they
-- may read. figure_brief does not.
grant select (figure) on public.mcq_questions to authenticated;
grant select (figure) on public.homework_questions to authenticated;

-- The shared quiz's writer, as before, now saving each question's figure.
create or replace function private.save_generated_quiz(_spec_point_id uuid, _questions jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _title text;
  _subject public.subject;
  _q jsonb;
  _n bigint;
  _set_id uuid;
begin
  select sp.code || ' ' || sp.title, t.subject
    into _title, _subject
  from public.spec_points sp
  join public.topics t on t.id = sp.topic_id
  where sp.id = _spec_point_id;
  if _title is null then
    raise exception 'Unknown spec point';
  end if;

  if jsonb_typeof(_questions) is distinct from 'array' or jsonb_array_length(_questions) = 0 then
    raise exception 'Refusing to save a quiz with no questions';
  end if;
  for _q, _n in
    select t.q, t.ord from jsonb_array_elements(_questions) with ordinality as t(q, ord)
  loop
    if jsonb_typeof(_q -> 'question') is distinct from 'string' or btrim(_q ->> 'question') = '' then
      raise exception 'Question % has no text', _n;
    end if;
    if jsonb_typeof(_q -> 'options') is distinct from 'array' then
      raise exception 'Question % needs four options', _n;
    end if;
    if jsonb_array_length(_q -> 'options') <> 4
       or exists (
         select 1 from jsonb_array_elements(_q -> 'options') o
         where jsonb_typeof(o) <> 'string'
            or btrim(regexp_replace(o #>> '{}', '\s+', ' ', 'g')) = ''
       ) then
      raise exception 'Question % needs four options, each with text', _n;
    end if;
    if (select count(distinct btrim(regexp_replace(o #>> '{}', '\s+', ' ', 'g')))
        from jsonb_array_elements(_q -> 'options') o) <> 4 then
      raise exception 'Question % has two identical options', _n;
    end if;
    if jsonb_typeof(_q -> 'correct_index') is distinct from 'number'
       or _q ->> 'correct_index' not in ('0', '1', '2', '3') then
      raise exception 'Question %''s answer key is not one of its four options', _n;
    end if;
    if jsonb_typeof(_q -> 'explanation') is distinct from 'string'
       or btrim(_q ->> 'explanation') = '' then
      raise exception 'Question % has no explanation', _n;
    end if;
    if jsonb_typeof(_q -> 'figure') is not distinct from 'object'
       and (jsonb_typeof(_q -> 'figure' -> 'svg') is distinct from 'string'
            or jsonb_typeof(_q -> 'figure' -> 'alt') is distinct from 'string') then
      raise exception 'Question %''s figure needs its drawing and its description', _n;
    end if;
  end loop;

  insert into public.mcq_sets
    (spec_point_id, title, description, published, subject, created_by, origin)
  values
    (_spec_point_id, _title, 'Practice questions for this spec point', true, _subject, null,
     'generated')
  on conflict (spec_point_id) where origin = 'generated' and spec_point_id is not null
  do nothing
  returning id into _set_id;

  -- Someone else's set got there first.
  if _set_id is null then
    return null;
  end if;

  insert into public.mcq_questions
    (set_id, position, question, options, correct_index, explanation, spec_point_id,
     figure, figure_brief)
  select
    _set_id,
    (t.ord - 1)::int,
    btrim(t.q ->> 'question'),
    t.q -> 'options',
    (t.q ->> 'correct_index')::int,
    btrim(t.q ->> 'explanation'),
    _spec_point_id,
    case when jsonb_typeof(t.q -> 'figure') = 'object' then t.q -> 'figure' end,
    case when jsonb_typeof(t.q -> 'figure') = 'object' then t.q -> 'figure_brief' end
  from jsonb_array_elements(_questions) with ordinality as t(q, ord);

  return _set_id;
end;
$function$;

-- The shared task's writer, as before, now saving each question's figure.
create or replace function private.save_generated_task(_spec_point_id uuid, _questions jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _title text;
  _subject public.subject;
  _board public.board;
  _level public.level;
  _q jsonb;
  _n bigint;
  _resource_id uuid;
begin
  select sp.code || ' ' || sp.title, t.subject, t.board, t.level
    into _title, _subject, _board, _level
  from public.spec_points sp
  join public.topics t on t.id = sp.topic_id
  where sp.id = _spec_point_id;
  if _title is null then
    raise exception 'Unknown spec point';
  end if;

  if jsonb_typeof(_questions) is distinct from 'array' or jsonb_array_length(_questions) = 0 then
    raise exception 'Refusing to save a task with no questions';
  end if;
  for _q, _n in
    select t.q, t.ord from jsonb_array_elements(_questions) with ordinality as t(q, ord)
  loop
    if jsonb_typeof(_q -> 'prompt') is distinct from 'string' or btrim(_q ->> 'prompt') = '' then
      raise exception 'Question % has no prompt', _n;
    end if;
    if jsonb_typeof(_q -> 'marks') is distinct from 'number'
       or _q ->> 'marks' !~ '^[0-9]{1,2}$'
       or (_q ->> 'marks')::int not between 1 and 30 then
      raise exception 'Question % must be worth a whole number of marks from 1 to 30', _n;
    end if;
    if coalesce(_q ->> 'answer_type', '') not in ('short', 'long', 'numeric') then
      raise exception 'Question %''s answer type must be short, long or numeric', _n;
    end if;
    if jsonb_typeof(_q -> 'mark_scheme') is distinct from 'string'
       or btrim(_q ->> 'mark_scheme') = '' then
      raise exception 'Question % has no mark scheme', _n;
    end if;
    if jsonb_typeof(_q -> 'figure') is not distinct from 'object'
       and (jsonb_typeof(_q -> 'figure' -> 'svg') is distinct from 'string'
            or jsonb_typeof(_q -> 'figure' -> 'alt') is distinct from 'string') then
      raise exception 'Question %''s figure needs its drawing and its description', _n;
    end if;
  end loop;

  insert into public.resources
    (kind, title, subject, board, level, spec_point_id, created_by, origin,
     review_status, publish_at)
  values
    ('homework', _title, _subject, _board, _level, _spec_point_id, null, 'generated',
     'to_review', now())
  on conflict (spec_point_id) where kind = 'homework' and spec_point_id is not null
  do nothing
  returning id into _resource_id;

  -- Someone else's task got there first.
  if _resource_id is null then
    return null;
  end if;

  insert into public.homework_questions
    (resource_id, position, prompt, marks, answer_type, mark_scheme, spec_point_id,
     figure, figure_brief)
  select
    _resource_id,
    (t.ord - 1)::int,
    t.q ->> 'prompt',
    (t.q ->> 'marks')::int,
    t.q ->> 'answer_type',
    btrim(t.q ->> 'mark_scheme'),
    _spec_point_id,
    case when jsonb_typeof(t.q -> 'figure') = 'object' then t.q -> 'figure' end,
    case when jsonb_typeof(t.q -> 'figure') = 'object' then t.q -> 'figure_brief' end
  from jsonb_array_elements(_questions) with ordinality as t(q, ord);

  insert into public.resource_spec_points (resource_id, spec_point_id)
  values (_resource_id, _spec_point_id)
  on conflict do nothing;

  return _resource_id;
end;
$function$;
