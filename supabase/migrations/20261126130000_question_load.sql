-- Reduced, Normal or Enhanced: how many of a point's questions a student sees.
--
-- Nadia raised that a topic's quiz and task can feel overwhelming. A student
-- now picks a level at sign-up and can change it on their profile (Ali's
-- levels, 26 Nov 2026):
--
--   reduced   the first 6 MCQs and the first 3 written questions
--   normal    the first 8 and the first 5: what everyone had before this
--   enhanced  all 10 and all 7, once the practice queue writes that many
--
-- The quiz and the task for a point stay shared: every student gets the same
-- questions, and a level only decides how many of the first ones are set. A
-- student is set the level's count or what is stored, whichever is smaller.
-- A quiz or task a tutor wrote (origin 'tutor') is always set whole.
--
-- The browser hiding questions is not enough: the server would mark the hidden
-- ones wrong. So the server works out the count, marks out of it, and files it
-- with the work (`shown_count`). Null means every question, which is every
-- row filed before this, so nothing already marked changes.
--
--   1. profiles.question_load, 'normal' for everyone until they choose.
--   2. private.shown_question_count: the caps, the same numbers as
--      QUESTION_CAPS in src/lib/practice/questionLoad.ts (a test keeps the two
--      in step).
--   3. mcq_attempts.shown_count and homework_submissions.shown_count.
--   4. grade_mcq_attempt marks a shared quiz out of the student's first
--      questions, ignores answers past them, and replays a filed attempt with
--      the count it was filed with. The weekly lock is unchanged.
--   5. submit_homework_answers files the count and writes one answer row for
--      each question set (blank where nothing was sent), none for the rest.
--   6. publish_homework_marks scores such work out of its answer rows.
--
-- The three functions are their live definitions with only that added: each
-- body's md5 was checked against production's before the edit (grade
-- 339ded353510b24602c4a152cfc0a11b, submit 287bc527ee33d63e6e5d409ca01aa6d2,
-- publish e93e825ab42dda8a6fe03447a1eafbe3, 26 Nov 2026). Their grants are
-- kept by "create or replace".
--
-- Safe to run before the app that uses it: with everyone on 'normal', a shared
-- quiz or task of 8 and 5 is set whole, as now.

alter table public.profiles add column if not exists question_load text not null default 'normal'
  constraint profiles_question_load_known check (question_load in ('reduced', 'normal', 'enhanced'));

-- `20260806232240_pin_identity_columns_on_profiles_grant_fix` dropped the
-- table-level UPDATE grant, so a new column arrives unwritable until it is
-- granted by name. "profiles self update" already holds the write to the
-- caller's own row.
grant update (question_load) on public.profiles to authenticated;

alter table public.mcq_attempts add column if not exists shown_count smallint
  constraint mcq_attempts_shown_count_range check (shown_count >= 0);
alter table public.homework_submissions add column if not exists shown_count smallint
  constraint homework_submissions_shown_count_range check (shown_count >= 0);

-- The caps. A level not listed counts as normal.
create or replace function private.shown_question_count(_kind text, _stored integer, _load text)
 returns integer
 language sql
 immutable
 set search_path to ''
as $function$
  select greatest(0, least(coalesce(_stored, 0),
    case _kind
      when 'quiz' then case _load when 'reduced' then 6 when 'enhanced' then 10 else 8 end
      when 'task' then case _load when 'reduced' then 3 when 'enhanced' then 7 else 5 end
    end))
$function$;

revoke all on function private.shown_question_count(text, integer, text) from public, anon, authenticated;

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
  -- A shared quiz is cut to the student's level; a tutor's own is set whole.
  _generated boolean;
  -- How many of the quiz's first questions this sitting is set. Null: all.
  _shown int;
  _shown_ids uuid[];
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
                false)),
         s.origin = 'generated'
    into _visible, _generated
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

  -- The questions this sitting is set: the quiz's first few by position, ties
  -- by id (position is not unique). A filed attempt keeps the count it was
  -- filed with. A new one on a shared quiz takes the student's level, and is
  -- marked out of that many.
  if _prior.id is not null then
    _shown := _prior.shown_count;
  elsif _generated then
    select private.shown_question_count('quiz', _total, p.question_load)
      into _shown
    from profiles p
    where p.id = _uid;
    _total := coalesce(_shown, _total);
  end if;
  select coalesce(array_agg(s.id), '{}')
    into _shown_ids
  from (
    select q.id
    from mcq_questions q
    where q.set_id = _set_id
    order by q.position, q.id
    limit _shown
  ) s;

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
      -- An answer to a question past the student's count is left out.
      and q.id = any(_shown_ids)
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
  where q.set_id = _set_id
    and q.id = any(_shown_ids);

  if _prior.id is not null then
    -- The score the attempt was filed with, which is what the planner holds.
    return jsonb_build_object(
      'attempt_id', _prior.id,
      'score', _prior.score,
      'total', _prior.total,
      'shown_count', _prior.shown_count,
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
      and q.id = any(_shown_ids)
    group by coalesce(q.spec_point_id, s.spec_point_id)
  ) scored;

  -- Retakes are deliberate (the planner resurfaces topics for another pass), so
  -- this appends rather than upserting; the FSRS ledger keys off the attempt id.
  -- A retake comes with a new id; only a retry of the same attempt repeats one.
  insert into mcq_attempts (id, set_id, user_id, score, total, answers, point_scores, shown_count)
  values (
    coalesce(_attempt_id, gen_random_uuid()),
    _set_id, _uid, _score, _total, _answers, _point_scores, _shown
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
    'shown_count', _shown,
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
  -- How many of a shared task's first questions this student is set. Null:
  -- every question, as on a task a tutor wrote.
  _shown int;
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

  -- A shared task is cut to the student's level: its first questions by
  -- position, ties by id. The count is filed with the work, so a later change
  -- of level leaves it as it was handed in.
  if exists (
    select 1 from public.resources r
    where r.id = _resource_id and r.origin = 'generated'
  ) then
    _shown := private.shown_question_count(
      'task',
      (select count(*)::int from public.homework_questions q where q.resource_id = _resource_id),
      (select p.question_load from public.profiles p where p.id = _uid)
    );
  end if;

  insert into public.homework_submissions (resource_id, student_id, notes, submitted_at, shown_count)
  values (_resource_id, _uid, nullif(btrim(coalesce(_notes, '')), ''), now(), _shown)
  returning id into _submission_id;

  -- Blank is nothing a reader can see: spaces, line breaks and invisible
  -- formatting characters (zero-width spaces, direction marks) only. One
  -- explicit list, the same as the sheet's (textLimits.ts), so the two agree
  -- whatever the database's locale counts as a space.
  insert into public.homework_answers (submission_id, question_id, answer_text)
  select
    _submission_id,
    s.question_id,
    case
      when regexp_replace(
             coalesce(s.answer_text, ''),
             '[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u00ad\u061c\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]',
             '', 'g') = '' then null
      else btrim(s.answer_text)
    end
  from (
    -- A tutor's task: the answers as they were sent.
    select (a ->> 'question_id')::uuid as question_id, a ->> 'answer_text' as answer_text
      from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a
     where _shown is null
    union all
    -- A shared task: one row for each question the student was set, blank
    -- where nothing was sent, and none for the questions past their count.
    -- These rows are the paper from here on: the marker, the tutor's marking
    -- card and the score all read them.
    select q.id, sent.answer_text
      from (
        select hq.id
          from public.homework_questions hq
         where hq.resource_id = _resource_id
         order by hq.position, hq.id
         limit _shown
      ) q
      left join lateral (
        select a ->> 'answer_text' as answer_text
          from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a
         where (a ->> 'question_id')::uuid = q.id
         limit 1
      ) sent on true
     where _shown is not null
  ) s;

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
     -- Work filed with a count (a shared task, cut to the student's level) is
     -- scored out of the questions it has an answer row for: hand-in wrote one
     -- for each question set, and none for the rest.
     and (a.id is not null
          or (_sub.shown_count is null and q.created_at <= _sub.submitted_at));

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

notify pgrst, 'reload schema';
