-- S-19 (quiz half): a retried quiz submission returns the first attempt
-- instead of filing a second one.
--
-- When the reply to a quiz submission was lost, the page said "try again", and
-- grade_mcq_attempt filed a second attempt. The planner and the analytics then
-- count it as two pieces of practice: the double count the page's in-flight
-- guard exists to prevent, arriving by another route.
--
-- The page now makes the attempt's id itself, when the student starts the quiz,
-- and keeps it with their unsent answers. This function takes it as
-- _attempt_id. The id is mcq_attempts' primary key, so the first call files the
-- attempt and any retry with the same id gets that attempt back, score and
-- all, without writing. Two retries racing each other meet at the primary key:
-- the loser's insert does nothing, and it returns the winner's attempt.
--
-- _attempt_id defaults to null, which behaves exactly as before (a new id every
-- call), so the app now live keeps working until the new one ships. The
-- two-argument version is dropped rather than overloaded: with both present,
-- PostgREST couldn't tell which one a call with two named arguments meant.
--
-- Everything else is the live definition (pg_get_functiondef, 1 Oct 2026).
-- Idempotent; safe in either order with the app.

drop function if exists public.grade_mcq_attempt(uuid, jsonb);

create or replace function public.grade_mcq_attempt(
  _set_id uuid,
  _answers jsonb,
  _attempt_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _uid uuid := auth.uid();
  _is_tutor boolean;
  _visible boolean;
  _total int;
  _score int;
  _results jsonb;
  _point_scores jsonb;
  _prior mcq_attempts%rowtype;
  _filed uuid;
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

  -- A retry of an attempt already filed: mark what was filed, not what was
  -- resent, and write nothing.
  if _attempt_id is not null then
    select * into _prior from mcq_attempts a where a.id = _attempt_id;
    if found then
      if _prior.user_id <> _uid or _prior.set_id <> _set_id then
        raise exception 'that attempt belongs to another quiz';
      end if;
      _answers := _prior.answers;
    end if;
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

  if _prior.id is not null then
    -- The score the attempt was filed with, which is what the planner holds.
    return jsonb_build_object(
      'attempt_id', _prior.id,
      'score', _prior.score,
      'total', _prior.total,
      'results', _results
    );
  end if;

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
  -- A retake comes with a new id; only a retry of the same attempt repeats one.
  insert into mcq_attempts (id, set_id, user_id, score, total, answers, point_scores)
  values (
    coalesce(_attempt_id, gen_random_uuid()),
    _set_id, _uid, _score, _total, coalesce(_answers, '{}'::jsonb), _point_scores
  )
  on conflict (id) do nothing
  returning id into _filed;

  if _filed is null then
    -- Another call with this id filed it while this one was marking. Return
    -- that attempt, through the replay path above.
    return public.grade_mcq_attempt(_set_id, _answers, _attempt_id);
  end if;

  return jsonb_build_object(
    'attempt_id', _filed,
    'score', _score,
    'total', _total,
    'results', _results
  );
end
$function$;

revoke all on function public.grade_mcq_attempt(uuid, jsonb, uuid) from public, anon;
grant execute on function public.grade_mcq_attempt(uuid, jsonb, uuid) to authenticated, service_role;
