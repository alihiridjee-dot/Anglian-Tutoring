-- Quizzes follow the subjects a student pays for (Argon review #3).
--
-- The quiz policies and grade_mcq_attempt checked only that the viewer had some
-- access (viewer_has_content_access), never which subjects. So a student paying
-- for one subject could open, and be marked on, every subject's quizzes, and a
-- parent could call grading and read the answer key back.
--
-- Now:
--   * A quiz is read only in a subject from private.my_content_subjects(), the
--     rule topics, notes and resources already follow: a student's paid
--     subjects, a parent's linked children's. A quiz with no subject of its own
--     takes its spec point's.
--   * Only a student is marked. A marked reply carries the answer key, and only
--     a student files attempts (a tutor's was already refused at the insert, by
--     student_row_not_staff).
--
-- Tutors read exactly as before. The weekly retake lock is unchanged: the
-- grading body is the live definition (20261005150000_mcq_retake_lock, md5
-- 287874b384b135839d774944ed5d5833) with only those two checks changed.
-- Idempotent.

-- A policy runs as the caller, and spec points are read per board, so the
-- fallback looks the subject up with the definer's rights.
create or replace function private.spec_point_subject(_spec_point_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select t.subject::text
  from public.spec_points sp
  join public.topics t on t.id = sp.topic_id
  where sp.id = _spec_point_id
$function$;

revoke all on function private.spec_point_subject(uuid) from public, anon;
grant execute on function private.spec_point_subject(uuid) to authenticated;

alter policy "mcq_sets read" on public.mcq_sets
  using (
    (select private.has_role((select auth.uid()), 'tutor'::app_role))
    or (
      published
      and (select private.viewer_has_content_access((select auth.uid())))
      and coalesce(subject::text, private.spec_point_subject(spec_point_id))
          in (select unnest(private.my_content_subjects()))
    )
  );

alter policy "mcq_questions read via set" on public.mcq_questions
  using (
    (select private.has_role((select auth.uid()), 'tutor'::app_role))
    or (
      (select private.viewer_has_content_access((select auth.uid())))
      and exists (
        select 1 from public.mcq_sets s
        where s.id = mcq_questions.set_id
          and s.published
          and coalesce(s.subject::text, private.spec_point_subject(s.spec_point_id))
              in (select unnest(private.my_content_subjects()))
      )
    )
  );

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

  -- Only a student is marked: the reply carries the answer key, and only a
  -- student files attempts. A parent or a tutor stops here.
  if private.is_staff(_uid) or not exists (
    select 1 from profiles p where p.id = _uid and p.role = 'student'
  ) then
    raise exception 'only students can submit quizzes';
  end if;

  -- The same visibility rule the mcq_sets policy applies. SECURITY DEFINER
  -- bypasses RLS, so this check has to be explicit: without it, any signed-in
  -- caller could grade -- and therefore read the answers to -- any set at all,
  -- including unpublished drafts and subjects they don't take.
  select (s.published
          and private.viewer_has_content_access(_uid)
          and coalesce(
                coalesce(s.subject::text, private.spec_point_subject(s.spec_point_id))
                  = any(private.my_content_subjects()),
                false))
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
