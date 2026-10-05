-- One counted attempt per quiz per week.
--
-- The answers and explanations appear the moment a quiz is marked, so a retake
-- straight afterwards measures the answer key, not the topic. Every attempt
-- feeds the planner: the best mark settles a topic at 70%, the predicted grade
-- averages every attempt, and FSRS read five instant 8/8s after a 3/8 as the
-- easiest topic there is (difficulty 6.4 -> 1.0).
--
-- A week is the planner's own floor (MIN_INTERVAL_DAYS): it never brings a
-- topic back sooner, so the retake the planner asks for is never refused.
--
-- Inside the week this files nothing and returns the attempt already filed,
-- marked, exactly as a retry of that attempt's id does. The page reads that
-- attempt on open and shows it as a review, so a student only meets this path
-- from a second tab. Both replies now carry retake_opens_at for the page.
--
-- Two submissions racing from two tabs would both pass the check before either
-- committed, so the check runs under a transaction lock per (student, quiz).
--
-- Everything else is the live definition (pg_get_functiondef, 5 Oct 2026,
-- md5 e0b122bd15398992ca8dfe6884cdacc8). Idempotent; the app now live keeps
-- working, since it ignores the new keys.

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
  _filed_at timestamptz;
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

  -- Held to the end of the transaction, so a second submission waits here and
  -- then finds the first one's attempt below.
  perform pg_advisory_xact_lock(hashtextextended('grade_mcq_attempt:' || _uid || ':' || _set_id, 0));

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

  -- A retake inside the week: the same, for the latest attempt on this quiz.
  if _prior.id is null then
    select * into _prior from mcq_attempts a
     where a.user_id = _uid
       and a.set_id = _set_id
       and a.created_at > now() - interval '7 days'
     order by a.created_at desc
     limit 1;
    if found then
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
      'results', _results,
      'retake_opens_at', _prior.created_at + interval '7 days'
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
  returning id, created_at into _filed, _filed_at;

  if _filed is null then
    -- Another call with this id filed it while this one was marking. Return
    -- that attempt, through the replay path above.
    return public.grade_mcq_attempt(_set_id, _answers, _attempt_id);
  end if;

  return jsonb_build_object(
    'attempt_id', _filed,
    'score', _score,
    'total', _total,
    'results', _results,
    'retake_opens_at', _filed_at + interval '7 days'
  );
end
$function$;

revoke all on function public.grade_mcq_attempt(uuid, jsonb, uuid) from public, anon;
grant execute on function public.grade_mcq_attempt(uuid, jsonb, uuid) to authenticated, service_role;
