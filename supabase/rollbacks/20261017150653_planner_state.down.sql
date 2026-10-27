-- Rollback for 20261017150653_planner_state: the planner reads its course piece
-- by piece again. Deploy the app without planner_state first; this one needs it.
begin;
create or replace function public.planner_course_snapshot(
  _student uuid, _subject public.subject, _board public.board, _level public.level
) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  topic_rows jsonb;
  point_rows jsonb;
  point_ids uuid[];
  sources jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'sort_order',sort_order)
    order by sort_order, id), '[]'::jsonb) into topic_rows
  from topics where subject = _subject and board = _board and level = _level;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'title',p.title,
    'sort_order',p.sort_order,'topic_id',p.topic_id,'weight',p.weight)), '[]'::jsonb),
    coalesce(array_agg(p.id), '{}'::uuid[]) into point_rows, point_ids
  from spec_points p join topics t on t.id = p.topic_id
  where t.subject = _subject and t.board = _board and t.level = _level;
  sources := public.planner_attempt_sources(point_ids);
  return jsonb_build_object('topics',topic_rows,'points',point_rows,'sources',sources,
    'submissions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',h.id,'resource_id',h.resource_id,'score_pct',h.score_pct,
      'graded_at',h.graded_at,'submitted_at',h.submitted_at))
      from homework_submissions h where h.student_id = _student and h.resource_id in (
        select (x->>'resource_id')::uuid from jsonb_array_elements(sources->'resourceLinks') x
      )), '[]'::jsonb),
    'attempts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'set_id',a.set_id,'score',a.score,'total',a.total,
      'created_at',a.created_at,'point_scores',a.point_scores))
      from mcq_attempts a where a.user_id = _student and a.set_id in (
        select (x->>'set_id')::uuid from jsonb_array_elements(sources->'setLinks') x
      )), '[]'::jsonb));
end;
$$;
drop function if exists public.planner_state(uuid, public.subject, public.board, public.level, date);
drop function if exists public.planner_point_evidence(uuid, uuid[]);
commit;
