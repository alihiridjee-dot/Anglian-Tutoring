-- One transaction for "this is the plan now".
--
-- Saving a week was three separate statements from the browser: upsert the plan
-- row, delete its points, insert the new ones. Between the delete and the insert
-- the plan exists with zero points, and anything that interrupts there — a
-- dropped connection, a closed tab, a failed insert — leaves it that way
-- permanently. The student opens their planner to an empty week and no error.
--
-- Concurrency made it worse rather than merely unlucky. The dashboard and the
-- planner's "This week" tab both build the current week when it's missing, so
-- mounting them together ran two of these sequences at once:
--
--   A: upsert plan ─ delete points ─ insert points
--   B:        upsert plan ─ delete points (wipes A's) ─ insert points → 23505
--
-- B's insert collides with A's on (plan_id, spec_point_id), the caller treats
-- the throw as "couldn't build a week", and the student is left with whichever
-- half survived.
--
-- Doing the whole thing in one function fixes both. The opening upsert takes a
-- row lock on the plan that is held to commit, so a second caller for the same
-- (student, subject, week) waits rather than interleaves — no advisory lock
-- needed, the unique constraint already names the thing to serialise on.
--
-- SECURITY INVOKER is deliberate: RLS still decides who may write this plan,
-- exactly as it did when the statements came from the client.
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

  -- Swap the point set wholesale. Same semantics as before, now inside the same
  -- transaction as the upsert above, so "no points" is never a state anyone
  -- else can observe.
  delete from student_weekly_plan_points where plan_id = _plan_id;

  insert into student_weekly_plan_points (plan_id, spec_point_id, origin, carried_from)
  select
    _plan_id,
    (e->>'spec_point_id')::uuid,
    coalesce((e->>'origin')::plan_point_origin, 'ai'::plan_point_origin),
    nullif(e->>'carried_from', '')::date
  from jsonb_array_elements(coalesce(_points, '[]'::jsonb)) e
  on conflict (plan_id, spec_point_id) do nothing;

  return _plan_id;
end
$$;

revoke all on function public.save_weekly_plan(uuid, subject, board, level, date, plan_source, text, jsonb) from public;
grant execute on function public.save_weekly_plan(uuid, subject, board, level, date, plan_source, text, jsonb) to authenticated;
