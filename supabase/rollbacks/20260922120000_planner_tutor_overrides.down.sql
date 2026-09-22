-- DOWN for migrations/20260922120000_planner_tutor_overrides.sql.
--
-- Kept out of supabase/migrations on purpose: the CLI applies everything in
-- that folder, in order, and a rollback must only ever run by hand.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -f supabase/rollbacks/20260922120000_planner_tutor_overrides.down.sql
--
-- Drops the override table (and every tutor decision in it), the trigger and
-- RPCs, restores `save_weekly_plan` and `reorder_student_topics` to their
-- 20260915120000 definitions, and returns the scheduler version to 4. Plan
-- rows themselves are untouched: a point a tutor removed stays removed until
-- the next re-cut puts it back, which is the behaviour this migration ended.

begin;

drop trigger if exists plan_point_overrides on public.student_weekly_plan_points;
drop function if exists public.enforce_plan_overrides();

drop function if exists public.remove_plan_point(uuid, subject, uuid, date, text);
drop function if exists public.skip_plan_point(uuid, subject, uuid, text);
drop function if exists public.plan_override_caller_is_tutor();

drop function if exists public.reorder_student_topics(subject, board, level, date, jsonb, date, jsonb, uuid[], jsonb, uuid);

create or replace function public.reorder_student_topics(
  _subject public.subject, _board public.board, _level public.level,
  _from date, _expected_pacing jsonb, _expected_exam date,
  _pacing jsonb, _assessed uuid[] default '{}', _reviews jsonb default '[]'::jsonb
) returns void language plpgsql security invoker set search_path = public as $$
declare
  _student uuid := auth.uid();
  _saved public.student_program_plan%rowtype;
  _week record;
  _points jsonb;
  _count integer;
  _protected jsonb;
begin
  if _student is null then raise exception 'Sign in to change topic order.'; end if;
  select * into _saved from student_program_plan
    where student_id = _student and subject = _subject for update;
  if not found then raise exception 'Open your planner before changing topic order.'; end if;
  if (select coalesce(jsonb_agg(b), '[]'::jsonb) from jsonb_array_elements(_saved.pacing) b where coalesce(b->>'kind','teach')='teach')
    is distinct from (select coalesce(jsonb_agg(b), '[]'::jsonb) from jsonb_array_elements(_expected_pacing) b where coalesce(b->>'kind','teach')='teach')
    or _saved.exam_date is distinct from _expected_exam then
    raise exception 'Your plan changed in another window. Reload and preview the order again.';
  end if;
  if _from < date_trunc('week', now() at time zone 'Europe/London')::date
    or extract(isodow from _from) <> 1 or _from >= _saved.exam_date then
    raise exception 'Choose a current or future Monday before your exams.';
  end if;
  if not exists (select 1 from student_enrolments where student_id = _student and subject = _subject and board = _board)
    or not exists (select 1 from profiles where id = _student and level = _level) then
    raise exception 'Your course changed. Reload your planner.';
  end if;
  if jsonb_typeof(_pacing) <> 'array' or jsonb_array_length(_pacing) = 0 or jsonb_array_length(_pacing) > 500 then
    raise exception 'Invalid topic order.';
  end if;
  if exists (select 1 from jsonb_array_elements(_pacing) b
    where coalesce(b->>'kind','teach') <> 'teach'
      or (b->>'startWeek')::date > (b->>'endWeek')::date
      or (b->>'endWeek')::date >= date_trunc('week', _saved.exam_date::timestamp)::date
      or extract(isodow from (b->>'startWeek')::date) <> 1
      or extract(isodow from (b->>'endWeek')::date) <> 1
      or (b->>'weeks')::int <> ((b->>'endWeek')::date - (b->>'startWeek')::date) / 7 + 1
      or b->>'fixedPoints' is distinct from 'true'
      or b->'schedule'->>'from' is distinct from _from::text
      or b->'schedule'->>'examDate' is distinct from _saved.exam_date::text
      or jsonb_typeof(b->'pointsByWeek') is distinct from 'object') then
    raise exception 'Invalid calendar allocation.';
  end if;
  if exists (select d from jsonb_array_elements(_pacing) b,
      lateral generate_series((b->>'startWeek')::date, (b->>'endWeek')::date, interval '7 days') d
      group by d having count(*) > 1) then raise exception 'Teaching weeks overlap.'; end if;
  if exists (select 1 from jsonb_array_elements(_pacing) b,
      lateral jsonb_each(b->'pointsByWeek') w,
      lateral jsonb_array_elements(w.value) p
      left join spec_points sp on sp.id::text = p->>'specPointId'
      left join topics t on t.id = sp.topic_id
    where sp.id is null or t.id::text <> b->>'topicId'
      or t.subject <> _subject or t.board <> _board or t.level <> _level
      or w.key::date < (b->>'startWeek')::date or w.key::date > (b->>'endWeek')::date
      or extract(isodow from w.key::date) <> 1) then
    raise exception 'A point is outside its topic or teaching dates.';
  end if;
  select count(*) into _count from jsonb_array_elements(_pacing) b,
    lateral jsonb_each(b->'pointsByWeek') w, lateral jsonb_array_elements(w.value) p;
  if _count <> (select count(distinct p->>'specPointId') from jsonb_array_elements(_pacing) b,
    lateral jsonb_each(b->'pointsByWeek') w, lateral jsonb_array_elements(w.value) p)
    or _count <> (select count(*) from spec_points sp join topics t on t.id = sp.topic_id
      where t.subject = _subject and t.board = _board and t.level = _level) then
    raise exception 'Every course point must appear exactly once. Reload if your curriculum changed.';
  end if;
  if exists (select 1 from jsonb_array_elements(_saved.pacing) old
    where coalesce(old->>'kind','teach')='teach' and (old->>'startWeek')::date < _from and not exists (
      select 1 from jsonb_array_elements(_pacing) b
      where b->>'topicId' = old->>'topicId' and b->>'startWeek' = old->>'startWeek'
        and (b->>'endWeek')::date = least((old->>'endWeek')::date, _from - 7)
        and (old->>'fixedPoints' is distinct from 'true' or not exists (
          select 1 from jsonb_each(old->'pointsByWeek') w where w.key::date < _from
            and b->'pointsByWeek'->w.key is distinct from w.value)))) then
    raise exception 'Earlier weeks must stay unchanged.';
  end if;

  perform id from student_weekly_plans where student_id = _student and subject = _subject
    and week_start >= _from order by week_start for update;
  select coalesce(jsonb_agg(jsonb_build_object('plan_id', wp.id, 'spec_point_id', pp.spec_point_id,
      'topic_id', sp.topic_id, 'week', wp.week_start, 'origin', pp.origin)), '[]'::jsonb)
    into _protected from student_weekly_plans wp
    join student_weekly_plan_points pp on pp.plan_id = wp.id
    join spec_points sp on sp.id = pp.spec_point_id
    where wp.student_id = _student and wp.subject = _subject and wp.week_start >= _from
      and (pp.done_at is not null or pp.carried_from is not null or pp.origin in ('student','tutor')
        or exists (select 1 from homework_submissions h join resources r on r.id = h.resource_id
          where h.student_id = _student and r.kind = 'homework'
            and (r.spec_point_id = pp.spec_point_id or exists (
              select 1 from resource_spec_points l where l.resource_id = r.id and l.spec_point_id = pp.spec_point_id)))
        or exists (select 1 from mcq_attempts a where a.user_id = _student
          and (a.point_scores ? pp.spec_point_id::text or exists (
            select 1 from mcq_sets m where m.id = a.set_id and m.spec_point_id = pp.spec_point_id)
            or exists (select 1 from mcq_questions q where q.set_id = a.set_id and q.spec_point_id = pp.spec_point_id))));
  select jsonb_agg(case when exists (select 1 from jsonb_array_elements(_protected) p where p->>'topic_id' = b->>'topicId' and (p->>'week')::date < least((b->>'openedWeek')::date, (b->>'startWeek')::date))
      then jsonb_set(b, '{openedWeek}', to_jsonb(least((b->>'openedWeek')::date,
        (select min((p->>'week')::date) from jsonb_array_elements(_protected) p where p->>'topic_id' = b->>'topicId'))::text))
      else b end order by ord) into _pacing from jsonb_array_elements(_pacing) with ordinality as items(b, ord);

  update student_program_plan set pacing = _pacing, acknowledged_at = now(), updated_at = now()
    where student_id = _student and subject = _subject;
  for _week in select * from student_weekly_plans
    where student_id = _student and subject = _subject and week_start >= _from
      and week_start < _saved.exam_date order by week_start for update
  loop
    with desired as (
      select (p->>'specPointId')::uuid as id, 'core'::plan_point_origin as origin from jsonb_array_elements(_pacing) b,
        lateral jsonb_array_elements(coalesce(b->'pointsByWeek'->_week.week_start::text, '[]'::jsonb)) p
        where not ((p->>'specPointId')::uuid = any(_assessed))
          and not exists (select 1 from student_weekly_plan_points done join student_weekly_plans wp on wp.id=done.plan_id
            where wp.student_id=_student and done.spec_point_id=(p->>'specPointId')::uuid and done.done_at is not null)
      union
      select (p->>'specPointId')::uuid, 'focus'::plan_point_origin from jsonb_array_elements(_reviews) b,
        lateral jsonb_array_elements(b->'points') p
        where b->>'startWeek' = _week.week_start::text and (p->>'specPointId')::uuid = any(_assessed)
      union
      select (p->>'spec_point_id')::uuid, (p->>'origin')::plan_point_origin
        from jsonb_array_elements(_protected) p where p->>'plan_id' = _week.id::text
      union
      select pp.spec_point_id, pp.origin from student_weekly_plan_points pp where pp.plan_id = _week.id
        and ((pp.origin = 'focus' and _week.week_start = date_trunc('week', now() at time zone 'Europe/London')::date) or (pp.origin <> 'focus' and exists (
          select 1 from jsonb_array_elements(_pacing) b, lateral jsonb_each(b->'pointsByWeek') w,
            lateral jsonb_array_elements(w.value) p
          where w.key::date < _from and p->>'specPointId' = pp.spec_point_id::text)))
    )
    select coalesce(jsonb_agg(jsonb_build_object('spec_point_id', d.id,
      'origin', case when exists (select 1 from jsonb_array_elements(_protected) p where p->>'plan_id' = _week.id::text and p->>'spec_point_id' = d.id::text) then pp.origin else d.origin end, 'carried_from', pp.carried_from)), '[]'::jsonb)
      into _points from (select id, case when bool_or(origin = 'focus') then 'focus'::plan_point_origin else min(origin::text)::plan_point_origin end as origin from desired group by id) d
        left join student_weekly_plan_points pp on pp.plan_id = _week.id and pp.spec_point_id = d.id;
    perform save_weekly_plan(_student, _subject, _board, _level, _week.week_start,
      _week.source, 'Updated to your chosen topic order. Reviews retain their assessed timing.', _points);
  end loop;
end $$;
revoke all on function public.reorder_student_topics(subject, board, level, date, jsonb, date, jsonb, uuid[], jsonb) from public, anon;
grant execute on function public.reorder_student_topics(subject, board, level, date, jsonb, date, jsonb, uuid[], jsonb) to authenticated;

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

  delete from student_weekly_plan_points p where p.plan_id = _plan_id
    and p.done_at is null and p.carried_from is null
    and p.origin not in ('student'::plan_point_origin, 'tutor'::plan_point_origin)
    and not exists (
      select 1 from homework_submissions h
      join resources r on r.id = h.resource_id
      where h.student_id = _student_id and r.kind = 'homework'
        and h.submitted_at >= (_week_start::timestamp at time zone 'Europe/London')
        and h.submitted_at < ((_week_start + 7)::timestamp at time zone 'Europe/London')
        and (r.spec_point_id = p.spec_point_id or exists (
          select 1 from resource_spec_points l
          where l.resource_id = r.id and l.spec_point_id = p.spec_point_id))
    )
    and not exists (
      select 1 from mcq_attempts a
      where a.user_id = _student_id
        and a.created_at >= (_week_start::timestamp at time zone 'Europe/London')
        and a.created_at < ((_week_start + 7)::timestamp at time zone 'Europe/London')
        and (a.point_scores ? p.spec_point_id::text or exists (
          select 1 from mcq_sets m where m.id = a.set_id and m.spec_point_id = p.spec_point_id
        ) or exists (
          select 1 from mcq_questions q where q.set_id = a.set_id and q.spec_point_id = p.spec_point_id
        ))
    )
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

  return _plan_id;
end
$$;
revoke all on function public.save_weekly_plan(uuid, subject, board, level, date, plan_source, text, jsonb) from public;
grant execute on function public.save_weekly_plan(uuid, subject, board, level, date, plan_source, text, jsonb) to authenticated;

drop function if exists public.plan_point_has_work(uuid, uuid, date);

drop trigger if exists plan_override_course on public.student_plan_overrides;
drop function if exists public.enforce_plan_override_course();
drop table if exists public.student_plan_overrides;
drop type if exists public.plan_override_kind;

create or replace function public.assessment_scheduler_version()
returns integer language sql stable security invoker set search_path = public
as $$ select 4 $$;
revoke all on function public.assessment_scheduler_version() from public, anon;
grant execute on function public.assessment_scheduler_version() to authenticated;

notify pgrst, 'reload schema';

commit;
