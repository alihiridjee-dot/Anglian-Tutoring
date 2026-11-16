-- Rollback for 20261116190000_mcq_answer_check: generated questions are saved
-- unchecked again. The writers go back to their earlier bodies first, so
-- nothing names the column while it goes. The check runs themselves are
-- deleted, as the format they carry is no longer allowed.
drop trigger if exists mcq_questions_require_answer_check on public.mcq_questions;
drop function if exists private.require_mcq_answer_check();

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

  delete from public.mcq_questions where set_id = _set_id;

  insert into public.mcq_questions
    (set_id, position, question, options, correct_index, explanation, spec_point_id)
  select
    _set_id,
    (t.ord - 1)::int,
    btrim(t.q ->> 'question'),
    t.q -> 'options',
    (t.q ->> 'correct_index')::int,
    nullif(btrim(coalesce(t.q ->> 'explanation', '')), ''),
    _point
  from jsonb_array_elements(_questions) with ordinality as t(q, ord);
  get diagnostics _count = row_count;

  update public.mcq_sets set updated_at = now() where id = _set_id;
  return _count;
end;
$function$;

revoke all on function public.replace_generated_mcq_questions(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_generated_mcq_questions(uuid, jsonb) to service_role;

alter table public.mcq_questions drop column if exists checked_run_id;

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
    and (r.usage is not null or r.api_status is null);
$function$;

revoke all on function private.practice_calls_24h() from public, anon, authenticated;

delete from public.exam_generation_runs where format = 'mcq_check';
alter table public.exam_generation_runs
  drop constraint exam_generation_runs_format_check,
  add constraint exam_generation_runs_format_check check (format in ('written', 'mcq'));
