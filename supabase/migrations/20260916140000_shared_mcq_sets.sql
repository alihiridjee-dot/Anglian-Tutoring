-- MCQs become library content, the way homework already is.
--
-- Until now every "generate" paid for a fresh set, and regenerating a weekly
-- quiz deleted its questions and paid again. Homework settled this months ago:
-- one sheet per spec point, written by whoever reaches the point first and read
-- by everyone after. MCQs now follow the same shape:
--
--  1. `mcq_sets.origin` marks the shared set the planner (or a tutor's generate
--     button) wrote for a spec point, and a partial unique index allows exactly
--     one per point. Tutor-built sets keep `origin = 'tutor'` and are unaffected.
--
--  2. `ensure_generated_mcq_set` writes that set, and only the app server may
--     call it. It is the concurrency guard: two students reaching the same point
--     at once both generate, and the loser's insert returns the winner's set.
--     Wasted tokens, not a duplicate. Passing null questions only looks the set
--     up, which finds one a tutor has unpublished (and a student therefore
--     cannot see) before paying to write it again.
--
--  3. `fill_mcq_set_from_shared` builds a tutor quiz by copying those questions,
--     so assigning or rebuilding a weekly quiz never pays for generation again.
--
--  4. `exam_generation_context` picks the past-paper examples that look most like
--     the spec point. No exemplar is tagged to a spec point yet, so every example
--     arrives as 'style' and was previously chosen by id — effectively at random.
--     Ranking by text similarity to the point makes the examples topical now,
--     and tagging will still outrank it once it exists. The pool also keeps MCQ
--     and written exemplars apart, so an MCQ request is never left with only
--     written questions to imitate.

-- ---------------------------------------------------------------------------
-- 1. Where a set came from
-- ---------------------------------------------------------------------------

alter table public.mcq_sets
  add column if not exists origin public.resource_origin not null default 'tutor';

comment on column public.mcq_sets.origin is
  '''tutor'' is a set a tutor built or assigned; ''generated'' is the one shared '
  'library set for its spec point, written once and reused by every student.';

create unique index if not exists mcq_sets_one_generated_per_spec_point
  on public.mcq_sets (spec_point_id)
  where origin = 'generated' and spec_point_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Writing the shared set
-- ---------------------------------------------------------------------------

/**
 * Return the shared MCQ set for a spec point, creating it from `_questions` if
 * none exists; with `_questions` null it only looks. `_questions` is
 * [{ question, options: [4 strings], correct_index, explanation }], already
 * validated by the generator and checked again here.
 *
 * Executable by the app server alone (service role), never by a browser. The set
 * is shared by every student, so a student able to call this directly could
 * write their own questions and answer key into everyone's quiz. `_created_by`
 * is the signed-in user the server acted for. The set is published straight
 * away, as generated homework is: a tutor can still unpublish or delete it.
 */
create or replace function public.ensure_generated_mcq_set(
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
    (_spec_point_id, _title, 'Practice questions for this spec point', true, _subject, _created_by,
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

-- ---------------------------------------------------------------------------
-- 3. Tutor quizzes built from the shared sets
-- ---------------------------------------------------------------------------

/**
 * Fill a tutor-built quiz with copies of the shared questions for each point, in
 * the order the points are given. Nothing is generated here: a weekly quiz costs
 * nothing once its points have their shared sets, and rebuilding one is free.
 *
 * Definer because the copy has to read `correct_index`, which no client can
 * select. Tutor-only, and only onto a tutor set, so it can never overwrite a
 * shared one.
 */
create or replace function public.fill_mcq_set_from_shared(
  _set_id uuid,
  _spec_point_ids uuid[]
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _copied int;
begin
  if _uid is null
     or not (private.has_role(_uid, 'tutor'::public.app_role)
             or private.has_role(_uid, 'admin'::public.app_role)) then
    raise exception 'Tutor access required';
  end if;

  if not exists (
    select 1 from public.mcq_sets s where s.id = _set_id and s.origin = 'tutor'
  ) then
    raise exception 'Quiz not found';
  end if;

  delete from public.mcq_questions where set_id = _set_id;

  insert into public.mcq_questions
    (set_id, position, question, options, correct_index, explanation, spec_point_id)
  select
    _set_id,
    (row_number() over (order by p.ord, q.position) - 1)::int,
    q.question, q.options, q.correct_index, q.explanation, q.spec_point_id
  from unnest(_spec_point_ids) with ordinality as p(id, ord)
  join public.mcq_sets s on s.origin = 'generated' and s.spec_point_id = p.id
  join public.mcq_questions q on q.set_id = s.id;

  get diagnostics _copied = row_count;
  return _copied;
end;
$$;

revoke all on function public.fill_mcq_set_from_shared(uuid, uuid[]) from public;
revoke execute on function public.fill_mcq_set_from_shared(uuid, uuid[]) from anon;
grant execute on function public.fill_mcq_set_from_shared(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Examples that look like the spec point
-- ---------------------------------------------------------------------------

create or replace function public.exam_generation_context(_spec_point_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with target as (
    select sp.id, sp.code, sp.title, sp.description, sp.topic_id,
      sp.assessment_context, t.title as topic_title,
      t.board::text as board, t.level::text as level, t.subject::text as subject,
      t.specification_version, t.exam_tier as tier
    from public.spec_points sp join public.topics t on t.id = sp.topic_id
    where sp.id = _spec_point_id
  ), terms as (
    -- The point's own words, stemmed, OR-ed together. Each lexeme is quoted so
    -- punctuation inside a spec title can't break the query.
    select (
      select to_tsquery('simple', string_agg(quote_literal(l), ' | '))
      from unnest(tsvector_to_array(to_tsvector('english',
        coalesce(p.title, '') || ' ' || coalesce(p.description, '')))) l
    ) as q
    from target p
  ), eligible as (
    select e.*, case
      when exists (select 1 from public.exam_exemplar_spec_points l
        where l.exemplar_id = e.id and l.spec_point_id = p.id) then 'exact'
      when exists (select 1 from public.exam_exemplar_spec_points l
        join public.spec_points sp on sp.id = l.spec_point_id
        where l.exemplar_id = e.id and sp.topic_id = p.topic_id) then 'topic'
      else 'style' end as grounding,
      (e.question_format = 'mcq' or e.options is not null) as is_mcq,
      case when terms.q is null then 0 else round(ts_rank(
        to_tsvector('english', coalesce(e.shared_context, '') || ' ' || e.prompt || ' '
          || coalesce(e.mark_scheme, '')),
        terms.q)::numeric, 4) end as similarity
    from public.exam_exemplars e cross join target p cross join terms
    where e.board = p.board and e.level = p.level and e.subject = p.subject
      and (p.specification_version is null or e.specification_version is null
        or e.specification_version = p.specification_version)
      and (p.tier is null or e.tier is null or e.tier = p.tier)
      and e.approved_at is not null and not e.needs_image and cardinality(e.flags) = 0
      and length(btrim(e.prompt)) > 0 and length(btrim(e.mark_scheme)) > 0 and e.marks > 0
  ), ranked as (
    select e.*, row_number() over (partition by grounding, is_mcq
      order by similarity desc, id) as pool_rank
    from eligible e
  )
  select jsonb_build_object(
    'point', to_jsonb(p),
    'examples', coalesce((select jsonb_agg(to_jsonb(e) - array['pool_rank', 'is_mcq'])
      from ranked e where pool_rank <= 20), '[]'::jsonb),
    'guidance', coalesce((select jsonb_agg(jsonb_build_object(
      'instructions', g.instructions, 'source_url', g.source_url))
      from public.exam_generation_guidance g
      where g.board = p.board and g.level = p.level
        and (g.subject is null or g.subject = p.subject)
        and (g.specification_version is null or g.specification_version = p.specification_version)), '[]'::jsonb)
  ) from target p;
$$;
revoke all on function public.exam_generation_context(uuid) from public, anon, authenticated;
grant execute on function public.exam_generation_context(uuid) to service_role;
