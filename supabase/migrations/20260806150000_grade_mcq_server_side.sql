-- Mark quizzes on the server, and stop shipping the answers to the browser.
--
-- The take-quiz page selected `correct_index` and `explanation` alongside the
-- question text and marked the paper in the browser. Every answer to every
-- published quiz was therefore sitting in the page's network response before
-- the student had chosen anything -- and `authenticated` held SELECT on the
-- whole table, so the answers were also one direct PostgREST query away for
-- anyone who looked. With one student that is a curiosity; with a cohort it is
-- a scoring integrity problem, and the marks feed the planner's FSRS engine, so
-- a cheated quiz quietly distorts what the student is shown next.
--
-- Grading moves here. The columns stay in the table (tutors author them, the
-- generator writes them) but are no longer readable by a client; the only way
-- to see an answer is to submit and be told.
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

  -- Retakes are deliberate (the planner resurfaces topics for another pass), so
  -- this appends rather than upserting; the FSRS ledger keys off the attempt id.
  insert into mcq_attempts (set_id, user_id, score, total, answers)
  values (_set_id, _uid, _score, _total, coalesce(_answers, '{}'::jsonb))
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

-- Revoking two columns is a no-op while a table-wide SELECT grant is in place --
-- the table grant covers every column, including ones revoked individually.
-- Drop the blanket grant and re-grant the readable columns explicitly.
-- INSERT/UPDATE stay granted so tutors and the AI generator can still author
-- questions; only reading the answers back is withdrawn.
revoke select on public.mcq_questions from authenticated;
revoke select on public.mcq_questions from anon;

grant select (id, set_id, position, question, options, spec_point_id, created_at)
  on public.mcq_questions to authenticated;
