-- Answer pictures: a multiple-choice question whose four answers are pictures
-- ("Which diagram shows a compound?"), each drawn and checked by the practice
-- queue's worker exactly as a question's figure is (src/lib/figures).
--
--   option_figures        [{ svg, alt } x 4], in the options' order: what a
--                         student's page reads, each the checker's own copy.
--   option_figure_briefs  [{ brief, drawn_by } x 4]: what the server keeps. A
--                         brief can name the answer, so students get no grant.
--
-- A question whose answers are words has neither. The quiz writer below takes
-- them from the worker's payload; nothing else writes them.

alter table public.mcq_questions
  add column option_figures jsonb,
  add column option_figure_briefs jsonb;

alter table public.mcq_questions
  add constraint mcq_questions_option_figures_shape check (
    -- "is not distinct from": a missing part is false, not unknown, which a
    -- check would let through.
    option_figures is null or (
      jsonb_typeof(option_figures) = 'array'
      and jsonb_array_length(option_figures) = 4
      and jsonb_typeof(option_figures -> 0) is not distinct from 'object'
      and jsonb_typeof(option_figures -> 0 -> 'svg') is not distinct from 'string'
      and jsonb_typeof(option_figures -> 0 -> 'alt') is not distinct from 'string'
      and length(option_figures -> 0 ->> 'svg') between 1 and 24000
      and length(option_figures -> 0 ->> 'alt') between 1 and 2000
      and jsonb_typeof(option_figures -> 1) is not distinct from 'object'
      and jsonb_typeof(option_figures -> 1 -> 'svg') is not distinct from 'string'
      and jsonb_typeof(option_figures -> 1 -> 'alt') is not distinct from 'string'
      and length(option_figures -> 1 ->> 'svg') between 1 and 24000
      and length(option_figures -> 1 ->> 'alt') between 1 and 2000
      and jsonb_typeof(option_figures -> 2) is not distinct from 'object'
      and jsonb_typeof(option_figures -> 2 -> 'svg') is not distinct from 'string'
      and jsonb_typeof(option_figures -> 2 -> 'alt') is not distinct from 'string'
      and length(option_figures -> 2 ->> 'svg') between 1 and 24000
      and length(option_figures -> 2 ->> 'alt') between 1 and 2000
      and jsonb_typeof(option_figures -> 3) is not distinct from 'object'
      and jsonb_typeof(option_figures -> 3 -> 'svg') is not distinct from 'string'
      and jsonb_typeof(option_figures -> 3 -> 'alt') is not distinct from 'string'
      and length(option_figures -> 3 ->> 'svg') between 1 and 24000
      and length(option_figures -> 3 ->> 'alt') between 1 and 2000
    )
  );

-- Students read questions column by column; the answer pictures join the
-- columns they may read. Their briefs do not.
grant select (option_figures) on public.mcq_questions to authenticated;

-- The shared quiz's writer, as before, now saving each question's answer pictures.
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
    -- Separate tests: SQL may evaluate either side of an "or" first, and
    -- jsonb_array_length refuses anything but an array.
    if jsonb_typeof(_q -> 'option_figures') is not distinct from 'array' then
      if jsonb_array_length(_q -> 'option_figures') <> 4
         or exists (
           select 1 from jsonb_array_elements(_q -> 'option_figures') f
           where jsonb_typeof(f -> 'svg') is distinct from 'string'
              or jsonb_typeof(f -> 'alt') is distinct from 'string'
         ) then
        raise exception 'Question %''s answer pictures need four drawings, each with its description', _n;
      end if;
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
     figure, figure_brief, option_figures, option_figure_briefs)
  select
    _set_id,
    (t.ord - 1)::int,
    btrim(t.q ->> 'question'),
    t.q -> 'options',
    (t.q ->> 'correct_index')::int,
    btrim(t.q ->> 'explanation'),
    _spec_point_id,
    case when jsonb_typeof(t.q -> 'figure') = 'object' then t.q -> 'figure' end,
    case when jsonb_typeof(t.q -> 'figure') = 'object' then t.q -> 'figure_brief' end,
    case when jsonb_typeof(t.q -> 'option_figures') = 'array' then t.q -> 'option_figures' end,
    case when jsonb_typeof(t.q -> 'option_figures') = 'array' then t.q -> 'option_figure_briefs' end
  from jsonb_array_elements(_questions) with ordinality as t(q, ord);

  return _set_id;
end;
$function$;

revoke all on function private.save_generated_quiz(uuid, jsonb) from public, anon, authenticated;
