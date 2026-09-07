-- Preserve completion when an explicitly reviewed weekly plan is applied.
create or replace function public.save_weekly_plan(
  _student_id uuid,
  _subject subject,
  _board board,
  _level level,
  _week_start date,
  _source plan_source,
  _rationale text,
  _points jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  _plan_id uuid;
  _count int;
begin
  if jsonb_typeof(coalesce(_points, '[]'::jsonb)) <> 'array' then
    raise exception 'points must be an array';
  end if;

  _count := jsonb_array_length(coalesce(_points, '[]'::jsonb));
  if _count > 200 then
    raise exception 'a week cannot hold more than 200 spec points';
  end if;

  insert into student_weekly_plans
    (student_id, subject, board, level, week_start, source, ai_rationale, updated_at)
  values
    (_student_id, _subject, _board, _level, _week_start, _source, _rationale, now())
  on conflict (student_id, subject, week_start) do update
    set board        = excluded.board,
        level        = excluded.level,
        source       = excluded.source,
        ai_rationale = excluded.ai_rationale,
        updated_at   = now()
  returning id into _plan_id;

  -- Replace only unprotected points, retaining completion and explicit choices.
  delete from student_weekly_plan_points p where p.plan_id = _plan_id
    and p.done_at is null and p.carried_from is null
    and p.origin not in ('student'::plan_point_origin, 'tutor'::plan_point_origin)
    and not exists (select 1 from jsonb_array_elements(coalesce(_points, '[]'::jsonb)) e
      where (e->>'spec_point_id')::uuid = p.spec_point_id);

  insert into student_weekly_plan_points (plan_id, spec_point_id, origin, carried_from)
  select
    _plan_id,
    (e->>'spec_point_id')::uuid,
    coalesce((e->>'origin')::plan_point_origin, 'ai'::plan_point_origin),
    nullif(e->>'carried_from', '')::date
  from jsonb_array_elements(coalesce(_points, '[]'::jsonb)) e
  on conflict (plan_id, spec_point_id) do update
    set origin = excluded.origin, carried_from = excluded.carried_from;
  -- Existing done_at values survive: completing work is never undone by a re-cut.

  return _plan_id;
end
$$;

revoke all on function public.save_weekly_plan(uuid, subject, board, level, date, plan_source, text, jsonb) from public;
grant execute on function public.save_weekly_plan(uuid, subject, board, level, date, plan_source, text, jsonb) to authenticated;

create or replace function public.assessment_scheduler_version()
returns integer language sql stable security invoker set search_path = public
as $$ select 2 $$;
revoke all on function public.assessment_scheduler_version() from public, anon;
grant execute on function public.assessment_scheduler_version() to authenticated;
