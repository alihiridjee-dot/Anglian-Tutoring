-- The answer check: a generated multiple-choice question is saved only with
-- the record of a model call that solved it blind and gave its key.
--
-- On 16 Nov 2026 a quiz went live asking "In which change is sulfur
-- oxidised?" with four options that were all reductions or no change. Nothing
-- looked at whether a key was right, only at a question's shape. The worker
-- now solves every question again without its key
-- (src/lib/mcq/answerCheck.server.ts) and sends, with each question, the run
-- that confirmed it. This migration makes that the only way in:
--
--   exam_generation_runs.format   'mcq_check' joins 'written' and 'mcq': one
--                                 row per blind solve, pass or fail.
--   mcq_questions.checked_run_id  the 'mcq_check' run that gave this
--                                 question's key. Null on a question a tutor
--                                 wrote, and on every question from before
--                                 this migration, which no check has seen.
--   the trigger                   refuses a new question in a generated set
--                                 unless that run exists, passed, and was for
--                                 the question's spec point. It sits on the
--                                 table, so a script or a new code path can't
--                                 save an unchecked question either.
--   the two quiz writers          take checked_run_id from each question.
--
-- A tutor signed in and writing a question by hand is their own check, and is
-- let through. Edits to a question already saved are not looked at.
--
-- Apply with the practice queue paused: between this and the worker's deploy,
-- a quiz the old worker writes is refused here (it retries later).
-- Rollback: supabase/rollbacks/20261116190000_mcq_answer_check.down.sql.

alter table public.exam_generation_runs
  drop constraint exam_generation_runs_format_check,
  add constraint exam_generation_runs_format_check
    check (format in ('written', 'mcq', 'mcq_check'));

comment on column public.exam_generation_runs.generated_questions is
  'What the call produced: the questions written, or for format mcq_check the questions solved, each with its key, the solver''s answer and whether they agreed.';

-- The daily cap is a limit on what the queue spends writing. A blind solve
-- costs a small fraction of the set it checks, and every quiz has at least
-- one: counted, they would halve the quizzes a day for a few pence.
create or replace function private.practice_calls_24h()
 returns integer
 language sql
 stable
 set search_path to ''
as $function$
  select count(*)::integer
  from public.exam_generation_runs r
  where r.job_id is not null
    and r.created_at > now() - interval '24 hours'
    and r.format <> 'mcq_check'
    and (r.usage is not null or r.api_status is null);
$function$;

revoke all on function private.practice_calls_24h() from public, anon, authenticated;

alter table public.mcq_questions
  add column checked_run_id uuid references public.exam_generation_runs(id) on delete set null;

comment on column public.mcq_questions.checked_run_id is
  'The mcq_check run that solved this question blind and gave its key. Null on a question a tutor wrote and on any from before 16 Nov 2026.';

-- No grant to students: the column is the server's.

create or replace function private.require_mcq_answer_check()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  -- A signed-in tutor writing by hand (the write policy lets nobody else in).
  if (select auth.uid()) is not null then
    return new;
  end if;
  if not exists (
    select 1 from public.mcq_sets s
    where s.id = new.set_id and s.origin = 'generated'
  ) then
    return new;
  end if;
  if new.checked_run_id is null or not exists (
    select 1 from public.exam_generation_runs r
    where r.id = new.checked_run_id
      and r.format = 'mcq_check'
      and r.outcome = 'passed'
      and r.spec_point_id is not distinct from new.spec_point_id
  ) then
    raise exception 'A generated question needs an answer check that passed for its spec point'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

revoke all on function private.require_mcq_answer_check() from public, anon, authenticated;

create trigger mcq_questions_require_answer_check
  before insert on public.mcq_questions
  for each row execute function private.require_mcq_answer_check();

-- The quiz writer, as in 20261029123927_option_figures, now carrying each
-- question's check.
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
    -- The trigger on mcq_questions checks the run itself; this names the question.
    if jsonb_typeof(_q -> 'checked_run_id') is distinct from 'string' then
      raise exception 'Question % has no answer check', _n;
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
     figure, figure_brief, option_figures, option_figure_briefs, checked_run_id)
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
    case when jsonb_typeof(t.q -> 'option_figures') = 'array' then t.q -> 'option_figure_briefs' end,
    (t.q ->> 'checked_run_id')::uuid
  from jsonb_array_elements(_questions) with ordinality as t(q, ord);

  return _set_id;
end;
$function$;

revoke all on function private.save_generated_quiz(uuid, jsonb) from public, anon, authenticated;

-- A tutor's "Replace questions", as in 20261001193000, now carrying each
-- question's check.
create or replace function public.replace_generated_mcq_questions(_set_id uuid, _questions jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _point uuid;
  _count int;
begin
  -- Locks the set, so two replacements run one after the other.
  select s.spec_point_id into _point
  from public.mcq_sets s
  where s.id = _set_id and s.origin = 'generated'
  for update;
  if _point is null then
    raise exception 'Quiz not found';
  end if;

  if jsonb_typeof(_questions) is distinct from 'array' or jsonb_array_length(_questions) = 0 then
    raise exception 'Refusing to replace a quiz with no questions';
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

  -- The trigger on mcq_questions checks each run itself; this says so plainly.
  if exists (
    select 1 from jsonb_array_elements(_questions) q
    where jsonb_typeof(q -> 'checked_run_id') is distinct from 'string'
  ) then
    raise exception 'A question has no answer check';
  end if;

  delete from public.mcq_questions where set_id = _set_id;

  insert into public.mcq_questions
    (set_id, position, question, options, correct_index, explanation, spec_point_id,
     checked_run_id)
  select
    _set_id,
    (t.ord - 1)::int,
    btrim(t.q ->> 'question'),
    t.q -> 'options',
    (t.q ->> 'correct_index')::int,
    nullif(btrim(coalesce(t.q ->> 'explanation', '')), ''),
    _point,
    (t.q ->> 'checked_run_id')::uuid
  from jsonb_array_elements(_questions) with ordinality as t(q, ord);
  get diagnostics _count = row_count;

  update public.mcq_sets set updated_at = now() where id = _set_id;
  return _count;
end;
$function$;

revoke all on function public.replace_generated_mcq_questions(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_generated_mcq_questions(uuid, jsonb) to service_role;
