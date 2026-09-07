-- Read-only aggregation. SECURITY INVOKER preserves every source table's RLS.
-- Deploy after assessment snapshots; old applications may read but no longer
-- write derived memory. Graded source records are the only active evidence.
begin;
create or replace function public.planner_attempt_sources(_ids uuid[])
returns jsonb language sql stable security invoker set search_path = public as $$
with resource_links as (
  select r.id resource_id, r.spec_point_id from resources r
  where r.kind = 'homework' and r.spec_point_id = any(_ids)
  union
  select l.resource_id, l.spec_point_id from resource_spec_points l
  join resources r on r.id = l.resource_id
  where r.kind = 'homework' and l.spec_point_id = any(_ids)
), set_links as (
  select s.id set_id, s.spec_point_id from mcq_sets s where s.spec_point_id = any(_ids)
  union
  select q.set_id, q.spec_point_id from mcq_questions q where q.spec_point_id = any(_ids)
), scope as (
  select s.id set_id, s.spec_point_id::text spec_point_id from mcq_sets s
  where s.id in (select set_id from set_links) and s.spec_point_id is not null
  union
  select q.set_id, coalesce(q.spec_point_id::text, s.spec_point_id::text, '__unattributed__')
  from mcq_questions q join mcq_sets s on s.id = q.set_id
  where q.set_id in (select set_id from set_links)
)
select jsonb_build_object(
  'resourceLinks', coalesce((select jsonb_agg(to_jsonb(r)) from resource_links r), '[]'::jsonb),
  'setLinks', coalesce((select jsonb_agg(to_jsonb(s)) from set_links s), '[]'::jsonb),
  'setScope', coalesce((select jsonb_agg(to_jsonb(s)) from scope s), '[]'::jsonb)
);
$$;

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
revoke all on function public.planner_attempt_sources(uuid[]) from public, anon;
revoke all on function public.planner_course_snapshot(uuid,public.subject,public.board,public.level) from public, anon;
grant execute on function public.planner_attempt_sources(uuid[]) to authenticated, service_role;
grant execute on function public.planner_course_snapshot(uuid,public.subject,public.board,public.level) to authenticated, service_role;

revoke insert, update, delete on public.student_spec_point_schedule from authenticated, anon;
revoke insert, update, delete on public.student_spec_point_reviews from authenticated, anon;
do $$ begin
  if to_regprocedure('public.record_reviews_atomic(jsonb)') is not null then
    revoke execute on function public.record_reviews_atomic(jsonb) from public, authenticated, anon;
  end if;
end $$;
commit;
