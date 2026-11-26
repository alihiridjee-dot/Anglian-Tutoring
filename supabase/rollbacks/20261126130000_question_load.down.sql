-- Rollback for 20261126130000_question_load.sql. Run by hand.
--
-- Puts grade_mcq_attempt, submit_homework_answers and publish_homework_marks
-- back as production had them on 26 Nov 2026 (20261028113000_mcq_quiz_edges,
-- 20261028110000_size_and_flood_limits and 20261027184100_answer_credited_quotes),
-- then takes away the caps function and the three columns.
--
-- Run it only with the app that reads the columns rolled back first. Work
-- filed in between keeps its score, but loses the count it was filed with:
-- a Reduced task then shows every question again, the unseen ones blank.

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

  if _prior.id is null then
    -- A paper opened before the quiz was rewritten: its answers name questions
    -- the quiz no longer has, and filing it would mark every one wrong.
    if exists (
      select 1 from jsonb_object_keys(coalesce(_answers, '{}'::jsonb)) k
      where not exists (
        select 1 from mcq_questions q where q.set_id = _set_id and q.id::text = k
      )
    ) then
      raise exception 'quiz has changed';
    end if;

    -- Keep only an answer the question can have: a whole number naming one of
    -- its options. Anything else is left unanswered, and nothing else is stored.
    select coalesce(jsonb_object_agg(q.id::text, (_answers ->> q.id::text)::int), '{}'::jsonb)
      into _answers
    from mcq_questions q
    where q.set_id = _set_id
      and case
            when (_answers ->> q.id::text) ~ '^[0-9]{1,4}$'
             and jsonb_typeof(q.options) = 'array'
            then (_answers ->> q.id::text)::int < jsonb_array_length(q.options)
            else false
          end;
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
    ) filter (
      -- Shown again later, an attempt gives the answers only to the questions
      -- it answered: after a rewrite, the new questions stay unseen.
      where _prior.id is null or _answers ? q.id::text
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
      'results', coalesce(_results, '[]'::jsonb),
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
    _set_id, _uid, _score, _total, _answers, _point_scores
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

create or replace function public.submit_homework_answers(_resource_id uuid, _answers jsonb, _notes text DEFAULT NULL::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _uid uuid := auth.uid();
  _submission_id uuid;
begin
  if _uid is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1 from public.resources r where r.id = _resource_id and r.kind = 'homework'
  ) then
    raise exception 'That task does not exist';
  end if;

  -- The resources policy's rule, for the caller (see the header).
  if not exists (
    select 1 from public.resources r
    where r.id = _resource_id
      and (
        private.has_role(_uid, 'tutor'::public.app_role)
        or (
          r.subject::text = any (private.student_paid_subjects(_uid))
          and (
            r.review_status = 'approved'
            or (r.review_status = 'to_review' and (r.publish_at is null or r.publish_at <= now()))
          )
        )
      )
  ) then
    raise exception 'That task is not open to you';
  end if;

  if exists (
    select 1 from public.homework_submissions s
    where s.resource_id = _resource_id and s.student_id = _uid
  ) then
    raise exception 'You have already submitted this task';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a
    where not exists (
      select 1 from public.homework_questions q
      where q.id = (a ->> 'question_id')::uuid and q.resource_id = _resource_id
    )
  ) then
    raise exception 'An answer refers to a question that is not on this task';
  end if;

  -- The same limit as homework_answers_answer_text_length, in words a
  -- student can act on.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a
    where char_length(btrim(coalesce(a ->> 'answer_text', ''))) > 5000
  ) then
    raise exception 'One of your answers is too long. Each answer can be up to 5,000 characters.';
  end if;

  insert into public.homework_submissions (resource_id, student_id, notes, submitted_at)
  values (_resource_id, _uid, nullif(btrim(coalesce(_notes, '')), ''), now())
  returning id into _submission_id;

  -- Blank is nothing a reader can see: spaces, line breaks and invisible
  -- formatting characters (zero-width spaces, direction marks) only. One
  -- explicit list, the same as the sheet's (textLimits.ts), so the two agree
  -- whatever the database's locale counts as a space.
  insert into public.homework_answers (submission_id, question_id, answer_text)
  select
    _submission_id,
    (a ->> 'question_id')::uuid,
    case
      when regexp_replace(
             coalesce(a ->> 'answer_text', ''),
             '[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u00ad\u061c\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]',
             '', 'g') = '' then null
      else btrim(a ->> 'answer_text')
    end
  from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a;

  delete from public.homework_drafts
   where student_id = _uid and resource_id = _resource_id;

  return _submission_id;
end;
$function$;

create or replace function public.publish_homework_marks(_submission_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _sub public.homework_submissions;
  _staged public.homework_ai_marks;
  _awarded numeric;
  _total numeric;
  _pct numeric;
  _title text;
begin
  if auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not private.has_role(auth.uid(), 'tutor'::public.app_role)
     and not private.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only tutors or admins may publish marks'
      using errcode = '42501';
  end if;

  select * into _sub
    from public.homework_submissions
   where id = _submission_id
     for update;

  if not found then
    raise exception 'No such submission';
  end if;

  if _sub.graded_at is not null then
    return false;
  end if;

  select * into _staged
    from public.homework_ai_marks
   where submission_id = _submission_id;

  if not found then
    return false;
  end if;

  perform set_config('app.publishing_marks', 'on', true);

  update public.homework_answers a
     set awarded_marks = least(greatest(coalesce((m ->> 'marks')::numeric, 0), 0), q.marks),
         feedback = nullif(btrim(coalesce(m ->> 'feedback', '')), ''),
         credited = _staged.credited -> q.id::text
    from jsonb_array_elements(coalesce(_staged.marks, '[]'::jsonb)) m
    join public.homework_questions q
      on q.id = (m ->> 'question_id')::uuid
   where a.submission_id = _submission_id
     and a.question_id = q.id;

  select coalesce(sum(a.awarded_marks), 0), coalesce(sum(q.marks), 0)
    into _awarded, _total
    from public.homework_questions q
    left join public.homework_answers a
      on a.question_id = q.id and a.submission_id = _submission_id
   where q.resource_id = _sub.resource_id
     and (a.id is not null or q.created_at <= _sub.submitted_at);

  _pct := case when _total > 0 then round((_awarded / _total) * 100) else null end;

  update public.homework_submissions
     set score_pct = _pct,
         grade = case
           when _pct is null then null
           when _pct >= 90 then '9' when _pct >= 80 then '8'
           when _pct >= 70 then '7' when _pct >= 60 then '6'
           when _pct >= 50 then '5' when _pct >= 40 then '4'
           when _pct >= 30 then '3' when _pct >= 20 then '2'
           else '1' end,
         feedback = coalesce(feedback, nullif(btrim(coalesce(_staged.summary, '')), '')),
         graded_at = now()
   where id = _submission_id;

  select r.title into _title
    from public.resources r
   where r.id = _sub.resource_id;

  insert into public.notifications (user_id, type, title, body, link, submission_id)
  values (
    _sub.student_id,
    'homework_marked',
    'Your task has been marked',
    coalesce(_title, 'Task') ||
      case when _pct is not null then ' — ' || _pct::text || '%' else '' end,
    '/homework/' || _sub.resource_id::text,
    _submission_id
  );

  return true;
end;
$function$;

drop function if exists private.shown_question_count(text, integer, text);

alter table public.homework_submissions drop column if exists shown_count;
alter table public.mcq_attempts drop column if exists shown_count;
alter table public.profiles drop column if exists question_load;

notify pgrst, 'reload schema';
