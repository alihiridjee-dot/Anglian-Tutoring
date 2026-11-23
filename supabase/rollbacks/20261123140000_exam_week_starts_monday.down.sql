-- Rollback for 20261123140000_exam_week_starts_monday: both functions as they were, compared
-- with the raw exam date again (20260915120000_student_topic_order and
-- 20261119222800_custom_plan_left_points). No rows change. Idempotent.

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
  select min(least((band->>'startWeek')::date, (band->>'openedWeek')::date,
      case when new.origin = 'focus' then (band->>'reviewStartWeek')::date end))
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

create or replace function public.reorder_student_topics(
  _subject public.subject, _board public.board, _level public.level,
  _from date, _expected_pacing jsonb, _expected_exam date,
  _pacing jsonb, _assessed uuid[] default '{}', _reviews jsonb default '[]'::jsonb,
  _student_id uuid default null
) returns void language plpgsql security invoker set search_path = public as $$
declare
  _student uuid := coalesce(_student_id, auth.uid());
  _saved public.student_program_plan%rowtype;
  _week record;
  _points jsonb;
  _protected jsonb;
begin
  if _student is null then raise exception 'Sign in to change topic order.'; end if;
  if _student <> auth.uid() and not plan_override_caller_is_tutor() then
    raise exception 'Only the student or their tutor can change their topic order.' using errcode = '42501';
  end if;
  select * into _saved from student_program_plan
    where student_id = _student and subject = _subject for update;
  if not found then raise exception 'Open the planner before changing topic order.'; end if;
  if (select coalesce(jsonb_agg(b), '[]'::jsonb) from jsonb_array_elements(_saved.pacing) b where coalesce(b->>'kind','teach')='teach')
    is distinct from (select coalesce(jsonb_agg(b), '[]'::jsonb) from jsonb_array_elements(_expected_pacing) b where coalesce(b->>'kind','teach')='teach')
    or _saved.exam_date is distinct from _expected_exam then
    raise exception 'The plan changed in another window. Reload and preview the order again.';
  end if;
  if _from < date_trunc('week', now() at time zone 'Europe/London')::date
    or extract(isodow from _from) <> 1 or _from >= _saved.exam_date then
    raise exception 'Choose a current or future Monday before the exams.';
  end if;
  if not exists (select 1 from student_enrolments where student_id = _student and subject = _subject and board = _board)
    or not exists (select 1 from profiles where id = _student and level = _level) then
    raise exception 'The course changed. Reload the planner.';
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
  -- A weekly slot belongs to one teaching topic, and every point stays on this course.
  if exists (select d from jsonb_array_elements(_pacing) b,
      lateral generate_series((b->>'startWeek')::date, (b->>'endWeek')::date, interval '7 days') d
      group by d having count(*) > 1) then raise exception 'Teaching weeks overlap.'; end if;
  -- The course's points are read once. Joined inside the loop over the weeks,
  -- they were read again for every week of the plan, each read under the
  -- caller's row rules, which test the tutor role row by row (9 Nov 2026).
  if exists (
    with placed as materialized (
      select b->>'topicId' as topic_id, (b->>'startWeek')::date as start_week,
        (b->>'endWeek')::date as end_week, w.key::date as week, p->>'specPointId' as point
      from jsonb_array_elements(_pacing) b,
        lateral jsonb_each(b->'pointsByWeek') w,
        lateral jsonb_array_elements(w.value) p),
    course as materialized (
      select sp.id::text as point, sp.topic_id::text as topic_id
      from spec_points sp join topics t on t.id = sp.topic_id
      where t.subject = _subject and t.board = _board and t.level = _level
        and not sp.not_examined)
    -- On the course and in its own topic from _from. An earlier week stands as
    -- stored (checked below), and a point it set may since have left the
    -- course or moved topic.
    select 1 from placed left join course c on c.point = placed.point
    where (placed.week >= _from and (c.point is null or c.topic_id <> placed.topic_id))
      or placed.week < placed.start_week or placed.week > placed.end_week
      or extract(isodow from placed.week) <> 1) then
    raise exception 'A point is outside its topic or teaching dates.';
  end if;
  -- Counted over the points on today's course: each placed once, and every
  -- one placed. A point that has left the course is not owed again.
  if exists (
    with placed as materialized (
      select p->>'specPointId' as point from jsonb_array_elements(_pacing) b,
        lateral jsonb_each(b->'pointsByWeek') w, lateral jsonb_array_elements(w.value) p),
    course as materialized (
      select sp.id::text as point from spec_points sp join topics t on t.id = sp.topic_id
      where t.subject = _subject and t.board = _board and t.level = _level
        and not sp.not_examined),
    counted as (select placed.point from placed join course on course.point = placed.point)
    select 1 where (select count(*) from counted) <> (select count(distinct point) from counted)
      or (select count(*) from counted) <> (select count(*) from course)) then
    raise exception 'Every course point must appear exactly once. Reload if the curriculum changed.';
  end if;
  -- Earlier topic bands cannot move. Previously frozen weekly point allocations
  -- also compare exactly, so a second reorder cannot rewrite the first one's history.
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

  -- Lock affected saved weeks before taking the preservation snapshot. A student
  -- can start future work early: protection is deliberately not week-scoped here.
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
  -- Preserve admission of work already started, even if its remaining topic now
  -- begins later. This records that teaching has already reached this topic.
  select jsonb_agg(case when exists (select 1 from jsonb_array_elements(_protected) p where p->>'topic_id' = b->>'topicId' and (p->>'week')::date < least((b->>'openedWeek')::date, (b->>'startWeek')::date))
      then jsonb_set(b, '{openedWeek}', to_jsonb(least((b->>'openedWeek')::date,
        (select min((p->>'week')::date) from jsonb_array_elements(_protected) p where p->>'topic_id' = b->>'topicId'))::text))
      else b end order by ord) into _pacing from jsonb_array_elements(_pacing) with ordinality as items(b, ord);

  update student_program_plan set pacing = _pacing, acknowledged_at = now(), updated_at = now()
    where student_id = _student and subject = _subject;
  for _week in select * from student_weekly_plans
    where student_id = _student and subject = _subject and week_start >= _from
      and week_start < _saved.exam_date
      -- A break week is never planned: plan_not_on_a_break refuses to save one,
      -- and that rolled the whole reorder back. It is left as it is. The weeks
      -- after the break follow the new order, as the planner shows them.
      and not exists (select 1 from student_breaks b where b.student_id = _student
        and b.cancelled_at is null
        and student_weekly_plans.week_start between b.starts_on and b.ends_on)
    order by week_start for update
  loop
    -- Retain assessed reviews and previously promised catch-up. The existing
    -- save function separately protects manual, completed, carried and attempted work.
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
        left join student_weekly_plan_points pp on pp.plan_id = _week.id and pp.spec_point_id = d.id
      -- Only this course's points go back in. A row left in the week from the
      -- student's previous board or level is not re-sent: save_weekly_plan keeps
      -- it if it holds their work and clears it if not, as the This week re-cut does.
      where exists (select 1 from spec_points sp join topics t on t.id = sp.topic_id
        where sp.id = d.id and t.subject = _subject and t.board = _board and t.level = _level);
    perform save_weekly_plan(_student, _subject, _board, _level, _week.week_start,
      _week.source, 'Updated to the chosen topic order. Reviews retain their assessed timing.', _points);
  end loop;
end $$;
