-- Non-destructive rollout: confidence history and existing cards remain archived.
-- NULL means historic, unsnapshotted evidence. Do not backfill from today's key.
-- Existing attempt read policies also protect these derived scores.
alter table public.mcq_attempts add column if not exists point_scores jsonb;
comment on column public.mcq_attempts.point_scores is
  'Immutable spec-point percentage scores captured by the server grader; NULL for legacy attempts.';

create or replace function public.grade_mcq_attempt(
  _set_id uuid,
  _answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _is_tutor boolean;
  _visible boolean;
  _total int;
  _score int;
  _attempt_id uuid;
  _results jsonb;
  _point_scores jsonb;
begin
  if _uid is null then
    raise exception 'not signed in';
  end if;
  if jsonb_typeof(coalesce(_answers, '{}'::jsonb)) <> 'object' then
    raise exception 'answers must be an object of question_id -> option index';
  end if;

  _is_tutor := private.has_role(_uid, 'tutor'::app_role);

  -- The same visibility rule the mcq_sets policy applies. SECURITY DEFINER
  -- bypasses RLS, so this check has to be explicit: without it, any signed-in
  -- caller could grade -- and therefore read the answers to -- any set at all,
  -- including unpublished drafts and other courses.
  select (_is_tutor or (s.published and private.viewer_has_content_access(_uid)))
    into _visible
  from mcq_sets s
  where s.id = _set_id;

  if _visible is null then
    raise exception 'quiz not found';
  end if;
  if not _visible then
    raise exception 'quiz not available';
  end if;

  select count(*) into _total from mcq_questions q where q.set_id = _set_id;
  if _total = 0 then
    raise exception 'quiz has no questions';
  end if;

  -- Grade against the stored answers. A question the student left out counts
  -- as wrong rather than erroring, so a partial submission still scores.
  select
    count(*) filter (
      where (_answers ->> q.id::text) is not null
        and (_answers ->> q.id::text)::int = q.correct_index
    ),
    jsonb_agg(
      jsonb_build_object(
        'question_id', q.id,
        'correct_index', q.correct_index,
        'explanation', q.explanation,
        'chosen_index', (_answers ->> q.id::text)::int,
        'correct', (_answers ->> q.id::text) is not null
                   and (_answers ->> q.id::text)::int = q.correct_index
      )
      order by q.position
    )
  into _score, _results
  from mcq_questions q
  where q.set_id = _set_id;

  -- Freeze per-skill evidence while the original answer key and tags are intact.
  -- Later author edits must not change a student's recorded performance.
  select coalesce(jsonb_object_agg(point_id::text, pct), '{}'::jsonb)
    into _point_scores
  from (
    select coalesce(q.spec_point_id, s.spec_point_id) as point_id,
      100.0 * count(*) filter (
        where (_answers ->> q.id::text) is not null
          and (_answers ->> q.id::text)::int = q.correct_index
      ) / count(*) as pct
    from mcq_questions q join mcq_sets s on s.id = q.set_id
    where q.set_id = _set_id and coalesce(q.spec_point_id, s.spec_point_id) is not null
    group by coalesce(q.spec_point_id, s.spec_point_id)
  ) scored;

  -- Retakes are deliberate (the planner resurfaces topics for another pass), so
  -- this appends rather than upserting; the FSRS ledger keys off the attempt id.
  insert into mcq_attempts (set_id, user_id, score, total, answers, point_scores)
  values (_set_id, _uid, _score, _total, coalesce(_answers, '{}'::jsonb), _point_scores)
  returning id into _attempt_id;

  return jsonb_build_object(
    'attempt_id', _attempt_id,
    'score', _score,
    'total', _total,
    'results', _results
  );
end
$$;

revoke all on function public.grade_mcq_attempt(uuid, jsonb) from public;
grant execute on function public.grade_mcq_attempt(uuid, jsonb) to authenticated;


revoke all on function public.grade_mcq_attempt(uuid, jsonb) from public, anon;
grant execute on function public.grade_mcq_attempt(uuid, jsonb) to authenticated;
