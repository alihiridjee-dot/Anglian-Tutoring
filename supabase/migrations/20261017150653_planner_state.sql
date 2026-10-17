-- One planner open, one round trip.
--
-- The planner asked for its course piece by piece: the stored programme, the
-- subject's pauses, the student's breaks, this week's plan, then its points,
-- then the course facts the admission rules check them against, the delivery
-- ledger and the tutor's overrides. Each read took the database a few
-- milliseconds. The trips to it did not, and most waited on the one before:
-- about fourteen in a row on an ordinary open and thirty on a week's first,
-- 4 to 15 seconds from where Ali sits (17 Oct, API logs).
--
-- planner_state answers all of it at once, in the shapes the client already
-- reads, so the client builds the full plan and the week from one answer.
-- planner_point_evidence does the same for a week's coverage check (what the
-- student attempted on a set of points), which took two trips.
--
-- Every function here is SECURITY INVOKER: each row is read as the caller,
-- under the same RLS as the reads it replaces, so a student, their tutor,
-- their parent and the nightly service-role job see exactly what they saw.
begin;

-- The work behind a set of spec points and the student's graded attempts at
-- it. planner_course_snapshot ended with exactly this; it now calls it.
create or replace function public.planner_point_evidence(_student uuid, _ids uuid[])
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  sources jsonb := public.planner_attempt_sources(_ids);
begin
  return jsonb_build_object('sources', sources,
    'submissions', coalesce((select jsonb_agg(jsonb_build_object(
      'id', h.id, 'resource_id', h.resource_id, 'score_pct', h.score_pct,
      'graded_at', h.graded_at, 'submitted_at', h.submitted_at))
      from homework_submissions h where h.student_id = _student and h.resource_id in (
        select (x->>'resource_id')::uuid from jsonb_array_elements(sources->'resourceLinks') x
      )), '[]'::jsonb),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'set_id', a.set_id, 'score', a.score, 'total', a.total,
      'created_at', a.created_at, 'point_scores', a.point_scores))
      from mcq_attempts a where a.user_id = _student and a.set_id in (
        select (x->>'set_id')::uuid from jsonb_array_elements(sources->'setLinks') x
      )), '[]'::jsonb));
end;
$$;

create or replace function public.planner_course_snapshot(
  _student uuid, _subject public.subject, _board public.board, _level public.level
) returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  topic_rows jsonb;
  point_rows jsonb;
  point_ids uuid[];
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'sort_order',sort_order)
    order by sort_order, id), '[]'::jsonb) into topic_rows
  from topics where subject = _subject and board = _board and level = _level;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'title',p.title,
    'sort_order',p.sort_order,'topic_id',p.topic_id,'weight',p.weight)), '[]'::jsonb),
    coalesce(array_agg(p.id), '{}'::uuid[]) into point_rows, point_ids
  from spec_points p join topics t on t.id = p.topic_id
  where t.subject = _subject and t.board = _board and t.level = _level;
  return jsonb_build_object('topics', topic_rows, 'points', point_rows)
    || public.planner_point_evidence(_student, point_ids);
end;
$$;

-- Everything one open of one course reads, for the week starting `_week`.
create or replace function public.planner_state(
  _student uuid, _subject public.subject, _board public.board, _level public.level, _week date
) returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'course', public.planner_course_snapshot(_student, _subject, _board, _level),
    'programme', (
      select jsonb_build_object('program_start', pp.program_start,
        'exam_date', pp.exam_date, 'pacing', pp.pacing)
      from student_program_plan pp where pp.student_id = _student and pp.subject = _subject),
    'profile', (
      select jsonb_build_object('level', pr.level, 'exam_year', pr.exam_year)
      from profiles pr where pr.id = _student),
    'boards', coalesce((
      select jsonb_agg(e.board) from student_enrolments e
      where e.student_id = _student and e.subject = _subject), '[]'::jsonb),
    'pauses', coalesce((
      select jsonb_agg(jsonb_build_object('id', sp.id, 'reason', sp.reason,
        'started_at', sp.started_at, 'ended_at', sp.ended_at,
        'programme_resumed_at', sp.programme_resumed_at) order by sp.started_at)
      from student_subject_pauses sp
      where sp.student_id = _student and sp.subject = _subject), '[]'::jsonb),
    'breaks', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'starts_on', b.starts_on,
        'ends_on', b.ends_on, 'reason', b.reason, 'recorded_at', b.recorded_at)
        order by b.starts_on)
      from student_breaks b
      where b.student_id = _student and b.cancelled_at is null), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'spec_point_id', o.spec_point_id,
        'kind', o.kind, 'week_start', o.week_start, 'note', o.note,
        'created_by', o.created_by, 'created_at', o.created_at) order by o.created_at)
      from student_plan_overrides o
      where o.student_id = _student and o.subject = _subject), '[]'::jsonb),
    'ledger', coalesce((
      select jsonb_agg(jsonb_build_object('week_start', w.week_start,
        'student_weekly_plan_points', coalesce((
          select jsonb_agg(jsonb_build_object('spec_point_id', wp.spec_point_id,
            'done_at', wp.done_at))
          from student_weekly_plan_points wp where wp.plan_id = w.id), '[]'::jsonb)))
      from student_weekly_plans w
      where w.student_id = _student and w.subject = _subject), '[]'::jsonb),
    'week', (
      select jsonb_build_object(
        'plan', jsonb_build_object('id', w.id, 'subject', w.subject, 'board', w.board,
          'level', w.level, 'week_start', w.week_start, 'source', w.source,
          'note', w.note, 'ai_rationale', w.ai_rationale),
        'points', coalesce((
          select jsonb_agg(jsonb_build_object('origin', wp.origin,
            'carried_from', wp.carried_from, 'done_at', wp.done_at,
            'spec_points', jsonb_build_object('id', p.id, 'code', p.code,
              'title', p.title, 'description', p.description,
              'topic_id', p.topic_id, 'sort_order', p.sort_order,
              'topics', case when t.id is null then null else jsonb_build_object(
                'title', t.title, 'sort_order', t.sort_order, 'subject', t.subject,
                'board', t.board, 'level', t.level) end)))
          from student_weekly_plan_points wp
          join spec_points p on p.id = wp.spec_point_id
          left join topics t on t.id = p.topic_id
          where wp.plan_id = w.id), '[]'::jsonb))
      from student_weekly_plans w
      where w.student_id = _student and w.subject = _subject and w.week_start = _week),
    'scheduler_version', public.assessment_scheduler_version()
  );
$$;

revoke all on function public.planner_point_evidence(uuid, uuid[]) from public, anon;
revoke all on function public.planner_state(uuid, public.subject, public.board, public.level, date)
  from public, anon;
grant execute on function public.planner_point_evidence(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.planner_state(uuid, public.subject, public.board, public.level, date)
  to authenticated, service_role;
commit;
