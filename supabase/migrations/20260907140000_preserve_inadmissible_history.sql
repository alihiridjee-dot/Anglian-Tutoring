-- Preserve historical assignments while application reads separate active work.
-- Forward repair: the preceding admissibility migration is already deployed.
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
    -- Even ungraded submissions are student work. Test the plan's London
    -- calendar week, and both direct and junction/question source links.
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
  -- Existing done_at values survive: completing work is never undone by a re-cut.

  return _plan_id;
end
$$;

revoke all on function public.save_weekly_plan(uuid, subject, board, level, date, plan_source, text, jsonb) from public;
grant execute on function public.save_weekly_plan(uuid, subject, board, level, date, plan_source, text, jsonb) to authenticated;

create or replace function public.assessment_scheduler_version()
returns integer language sql stable security invoker set search_path = public
as $$ select 4 $$;
revoke all on function public.assessment_scheduler_version() from public, anon;
grant execute on function public.assessment_scheduler_version() to authenticated;

-- A known level must still match when the subject has no enrolment row.
create or replace function public.enforce_plan_matches_enrolment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _enrolments int;
  _matching   int;
  _level      level;
begin
  select count(*) into _enrolments
  from student_enrolments e
  where e.student_id = new.student_id and e.subject = new.subject;

  select count(*) into _matching
  from student_enrolments e
  where e.student_id = new.student_id
    and e.subject = new.subject
    and e.board = new.board;

  if _enrolments > 0 and _matching = 0 then
    raise exception
      'student % is not enrolled on % with board % — plan board does not match enrolment',
      new.student_id, new.subject, new.board
      using errcode = '23514';
  end if;

  select p.level into _level from profiles p where p.id = new.student_id;

  if _level is not null and _level <> new.level then
    raise exception
      'student % sits %, not % — plan level does not match their profile',
      new.student_id, _level, new.level
      using errcode = '23514';
  end if;

  return new;
end
$$;


create or replace function public.enforce_plan_point_admissible()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _plan       record;
  _topic      record;
  _band_start date;
  _exam_date date;
begin
  select p.student_id, p.subject, p.board, p.level, p.week_start
    into _plan
  from student_weekly_plans p
  where p.id = new.plan_id;

  -- The foreign key owns this case; nothing to say about an absent plan.
  if not found then
    return new;
  end if;

  select t.id, t.subject, t.board, t.level
    into _topic
  from spec_points sp
  join topics t on t.id = sp.topic_id
  where sp.id = new.spec_point_id;

  if not found then
    raise exception 'spec point % does not belong to a topic', new.spec_point_id
      using errcode = '23514';
  end if;

  if _topic.subject <> _plan.subject
     or _topic.board <> _plan.board
     or _topic.level <> _plan.level then
    raise exception 'spec point % is on a different course (%/%/%) than this plan (%/%/%)',
      new.spec_point_id, _topic.subject, _topic.board, _topic.level,
      _plan.subject, _plan.board, _plan.level
      using errcode = '23514';
  end if;

  if exists (select 1 from student_enrolments e
      where e.student_id = _plan.student_id and e.subject = _plan.subject)
    and not exists (select 1 from student_enrolments e
      where e.student_id = _plan.student_id and e.subject = _plan.subject and e.board = _plan.board)
    or exists (select 1 from profiles p where p.id = _plan.student_id
      and p.level is not null and p.level <> _plan.level) then
    raise exception 'plan course no longer matches student enrolment' using errcode = '23514';
  end if;

  select exam_date into _exam_date from student_program_plan
    where student_id = _plan.student_id and subject = _plan.subject;
  if _exam_date is not null and _plan.week_start >= _exam_date then
    raise exception 'week is at or past the programme exam date' using errcode = '23514';
  end if;

  -- A person's choice may outrun the programme's pace; the programme's may not.
  if new.origin in ('student'::plan_point_origin, 'tutor'::plan_point_origin) then
    return new;
  end if;

  -- Bands stored before `kind` existed are spine bands, matching isTeachBand().
  select min((band->>'startWeek')::date)
    into _band_start
  from student_program_plan spp,
       lateral jsonb_array_elements(coalesce(spp.pacing, '[]'::jsonb)) band
  where spp.student_id = _plan.student_id
    and spp.subject = _plan.subject
    and band->>'topicId' = _topic.id::text
    and coalesce(band->>'kind', 'teach') = 'teach';

  -- No programme seeded yet means there is no spine to be ahead of.
  if _band_start is not null and _band_start > _plan.week_start then
    raise exception 'spec point % is in a topic the programme does not reach until %',
      new.spec_point_id, _band_start
      using errcode = '23514';
  end if;

  return new;
end
$$;

