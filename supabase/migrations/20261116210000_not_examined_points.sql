-- Lab-only skills leave the course, and the skills topic moves to the end.
--
-- A new OCR A-level science student met 37 "practical skills" points before
-- any chemistry, biology or physics (Ali, 16 Nov 2026: "very overwhelming
-- when you first set up a profile"). 22 of them in each subject (codes 1.2.1
-- and 1.2.2, e.g. "Online and offline research skills") are OCR's Practical
-- Endorsement: the student's own teacher signs them off in the school lab,
-- pass or fail. They carry no exam marks and cannot be taught or marked here.
--
-- 1. spec_points.not_examined marks such a point. A marked point is not part
--    of the course: the planner's snapshot leaves it out, so it is never
--    planned, counted or queued for practice, and the two functions that
--    check a saved calendar against the course ("every course point exactly
--    once") count the same set. A student cannot request practice on one.
--    The row, its notes, videos, quizzes and any past work stay, so clearing
--    the mark brings the point back.
-- 2. The 66 OCR A-level points (22 x 3 subjects) are marked.
-- 3. Their rows in a plan week that nobody has started are cleared, as
--    save_weekly_plan clears stale automatic rows. On 16 Nov that is 14 rows
--    for one student, none started.
-- 4. "Development of practical skills" (now the 15 points examined in the
--    written papers) moves from first to last in each subject. A programme
--    already saved keeps its own calendar: three students who began on
--    9 Nov finish this topic now, as planned. New students meet it last.
--
-- The four function bodies are production's (checked by md5 on 16 Nov) with
-- only the not_examined test added. Same signatures, grants and security.
-- Idempotent.
--
-- Rollback: supabase/rollbacks/20261116210000_not_examined_points.down.sql

alter table public.spec_points
  add column if not exists not_examined boolean not null default false;
comment on column public.spec_points.not_examined is
  'True for a point no written paper examines (OCR''s Practical Endorsement, signed off by the school). Left out of the course: never planned, listed, counted or queued.';

-- 1. The course is its examined points.
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
  where t.subject = _subject and t.board = _board and t.level = _level
    and not p.not_examined;
  return jsonb_build_object('topics', topic_rows, 'points', point_rows)
    || public.planner_point_evidence(_student, point_ids);
end;
$$;

create or replace function public.resume_programme_after_pause(
  _pause_id uuid,
  _expected_pacing jsonb,
  _pacing jsonb
)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _pause public.student_subject_pauses%rowtype;
  _saved public.student_program_plan%rowtype;
  _board public.board;
  _level public.level;
  _paused_from date;
  _resume_from date;
  _count integer;
begin
  select * into _pause from public.student_subject_pauses where id = _pause_id for update;
  if not found then
    raise exception 'That pause no longer exists.';
  end if;
  if _pause.student_id is distinct from (select auth.uid())
     and not public.plan_override_caller_is_tutor() then
    raise exception 'Only the student or their tutor can pick their plan up after a pause.'
      using errcode = '42501';
  end if;
  -- Another window got there first.
  if _pause.programme_resumed_at is not null then
    return;
  end if;
  if _pause.ended_at is null or exists (
    select 1 from public.student_subject_pauses o
    where o.student_id = _pause.student_id and o.subject = _pause.subject and o.ended_at is null
  ) then
    raise exception 'This subject is paused, so nothing new can be planned for it.'
      using errcode = '23514', hint = 'subject_paused';
  end if;
  -- Stops are picked up in the order they happened.
  if exists (
    select 1 from public.student_subject_pauses o
    where o.student_id = _pause.student_id and o.subject = _pause.subject
      and o.programme_resumed_at is null and o.started_at < _pause.started_at
  ) then
    raise exception 'An earlier pause has to be picked up first. Reload the planner.';
  end if;
  -- The planner found nothing to move (nothing left to teach, too few weeks
  -- before the exam, or a course that changed and starts afresh anyway).
  if _pacing is null then
    update public.student_subject_pauses set programme_resumed_at = now() where id = _pause_id;
    return;
  end if;

  _paused_from := date_trunc('week', _pause.started_at at time zone 'Europe/London')::date;
  _resume_from := date_trunc('week', _pause.ended_at at time zone 'Europe/London')::date;

  select * into _saved from public.student_program_plan
   where student_id = _pause.student_id and subject = _pause.subject
   for update;
  -- Nothing to move: no programme, or stopped and started within one week.
  if not found or _resume_from <= _paused_from then
    update public.student_subject_pauses set programme_resumed_at = now() where id = _pause_id;
    return;
  end if;

  if (select coalesce(jsonb_agg(b), '[]'::jsonb) from jsonb_array_elements(_saved.pacing) b
       where coalesce(b->>'kind', 'teach') = 'teach')
     is distinct from
     (select coalesce(jsonb_agg(b), '[]'::jsonb) from jsonb_array_elements(_expected_pacing) b
       where coalesce(b->>'kind', 'teach') = 'teach') then
    raise exception 'The plan changed in another window. Reload the planner.';
  end if;
  if _resume_from >= _saved.exam_date then
    raise exception 'The exams have started, so there is nothing to re-plan.';
  end if;

  select e.board into _board from public.student_enrolments e
   where e.student_id = _pause.student_id and e.subject = _pause.subject;
  select p.level into _level from public.profiles p where p.id = _pause.student_id;
  if _board is null or _level is null then
    raise exception 'The course changed. Reload the planner.';
  end if;

  -- The new calendar, checked as a topic order is.
  if jsonb_typeof(_pacing) is distinct from 'array'
     or jsonb_array_length(_pacing) = 0 or jsonb_array_length(_pacing) > 500 then
    raise exception 'Invalid plan.';
  end if;
  if exists (select 1 from jsonb_array_elements(_pacing) b
    where coalesce(b->>'kind', 'teach') <> 'teach'
      or (b->>'startWeek')::date > (b->>'endWeek')::date
      or (b->>'endWeek')::date >= date_trunc('week', _saved.exam_date::timestamp)::date
      or extract(isodow from (b->>'startWeek')::date) <> 1
      or extract(isodow from (b->>'endWeek')::date) <> 1
      or (b->>'weeks')::int <> ((b->>'endWeek')::date - (b->>'startWeek')::date) / 7 + 1
      or b->>'fixedPoints' is distinct from 'true'
      or b->'schedule'->>'from' is distinct from _resume_from::text
      or b->'schedule'->>'examDate' is distinct from _saved.exam_date::text
      or jsonb_typeof(b->'pointsByWeek') is distinct from 'object') then
    raise exception 'Invalid calendar allocation.';
  end if;
  if exists (select d from jsonb_array_elements(_pacing) b,
      lateral generate_series((b->>'startWeek')::date, (b->>'endWeek')::date, interval '7 days') d
      group by d having count(*) > 1) then
    raise exception 'Teaching weeks overlap.';
  end if;
  if exists (select 1 from jsonb_array_elements(_pacing) b,
      lateral jsonb_each(b->'pointsByWeek') w,
      lateral jsonb_array_elements(w.value) p
      left join public.spec_points sp on sp.id::text = p->>'specPointId'
        and not sp.not_examined
      left join public.topics t on t.id = sp.topic_id
    where sp.id is null or t.id::text <> b->>'topicId'
      or t.subject <> _pause.subject or t.board <> _board or t.level <> _level
      or w.key::date < (b->>'startWeek')::date or w.key::date > (b->>'endWeek')::date
      or extract(isodow from w.key::date) <> 1) then
    raise exception 'A point is outside its topic or teaching dates.';
  end if;
  select count(*) into _count from jsonb_array_elements(_pacing) b,
    lateral jsonb_each(b->'pointsByWeek') w, lateral jsonb_array_elements(w.value) p;
  if _count <> (select count(distinct p->>'specPointId') from jsonb_array_elements(_pacing) b,
      lateral jsonb_each(b->'pointsByWeek') w, lateral jsonb_array_elements(w.value) p)
    or _count <> (select count(*) from public.spec_points sp join public.topics t on t.id = sp.topic_id
      where t.subject = _pause.subject and t.board = _board and t.level = _level
        and not sp.not_examined) then
    raise exception 'Every course point must appear exactly once. Reload if the curriculum changed.';
  end if;

  -- Weeks before the pause stay exactly as they were.
  if exists (select 1 from jsonb_array_elements(_saved.pacing) old
    where coalesce(old->>'kind', 'teach') = 'teach' and (old->>'startWeek')::date < _paused_from
      and not exists (
        select 1 from jsonb_array_elements(_pacing) b
        where b->>'topicId' = old->>'topicId' and b->>'startWeek' = old->>'startWeek'
          and (b->>'endWeek')::date = least((old->>'endWeek')::date, _paused_from - 7)
          and (old->>'fixedPoints' is distinct from 'true' or not exists (
            select 1 from jsonb_each(old->'pointsByWeek') w where w.key::date < _paused_from
              and b->'pointsByWeek'->w.key is distinct from w.value)))) then
    raise exception 'Weeks before the pause must stay as they were.';
  end if;
  if exists (select 1 from jsonb_array_elements(_pacing) b
    where (b->>'startWeek')::date < _paused_from and not exists (
      select 1 from jsonb_array_elements(_saved.pacing) old
      where coalesce(old->>'kind', 'teach') = 'teach'
        and old->>'topicId' = b->>'topicId' and old->>'startWeek' = b->>'startWeek')) then
    raise exception 'Weeks before the pause must stay as they were.';
  end if;
  -- And the weeks it was stopped hold no teaching.
  if exists (select 1 from jsonb_array_elements(_pacing) b
    where (b->>'startWeek')::date >= _paused_from and (b->>'startWeek')::date < _resume_from) then
    raise exception 'Nothing can be taught in the weeks the subject was paused.';
  end if;

  update public.student_program_plan
     set pacing = _pacing, acknowledged_at = now(), updated_at = now()
   where student_id = _pause.student_id and subject = _pause.subject;
  update public.student_subject_pauses set programme_resumed_at = now() where id = _pause_id;
end;
$function$;

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
  _count integer;
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
    select 1 from placed left join course c on c.point = placed.point
    where c.point is null or c.topic_id <> placed.topic_id
      or placed.week < placed.start_week or placed.week > placed.end_week
      or extract(isodow from placed.week) <> 1) then
    raise exception 'A point is outside its topic or teaching dates.';
  end if;
  select count(*) into _count from jsonb_array_elements(_pacing) b,
    lateral jsonb_each(b->'pointsByWeek') w, lateral jsonb_array_elements(w.value) p;
  if _count <> (select count(distinct p->>'specPointId') from jsonb_array_elements(_pacing) b,
    lateral jsonb_each(b->'pointsByWeek') w, lateral jsonb_array_elements(w.value) p)
    or _count <> (select count(*) from spec_points sp join topics t on t.id = sp.topic_id
      where t.subject = _subject and t.board = _board and t.level = _level
        and not sp.not_examined) then
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

create or replace function private.can_request_practice(_uid uuid, _spec_point_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select _uid is not null
     and not private.is_staff(_uid)
     and exists (
       select 1
       from public.spec_points sp
       join public.topics t on t.id = sp.topic_id
       join public.profiles p on p.id = _uid
       where sp.id = _spec_point_id
         and not sp.not_examined
         and p.role = 'student'
         and p.level = t.level
         and t.subject::text = any (private.student_paid_subjects(_uid))
         and exists (
           select 1 from public.student_enrolments e
           where e.student_id = _uid and e.subject = t.subject and e.board = t.board
         )
     );
$function$;

-- 2. Mark OCR's Practical Endorsement points (module 1.2).
update public.spec_points sp
   set not_examined = true
  from public.topics t
 where t.id = sp.topic_id
   and t.board = 'ocr' and t.level = 'alevel' and t.code = 'Topic 1'
   and sp.code ~ '^OCR 1\.2\.'
   and not sp.not_examined;

do $$
declare _n integer;
begin
  select count(*) into _n from public.spec_points where not_examined;
  if _n <> 66 then
    raise exception 'Expected 66 not-examined points, found %', _n;
  end if;
end $$;

-- 3. Clear their unstarted rows from saved weeks.
delete from public.student_weekly_plan_points p
 using public.student_weekly_plans w, public.spec_points sp
 where w.id = p.plan_id and sp.id = p.spec_point_id
   and sp.not_examined
   and p.done_at is null and p.carried_from is null
   and p.origin not in ('student'::public.plan_point_origin, 'tutor'::public.plan_point_origin)
   and not public.plan_point_has_work(w.student_id, p.spec_point_id, w.week_start);

-- 4. The skills topic goes last. Only while it is still first, so a second
--    run moves nothing.
update public.topics t
   set sort_order = (select max(o.sort_order) + 1 from public.topics o
                      where o.subject = t.subject and o.board = t.board and o.level = t.level)
 where t.board = 'ocr' and t.level = 'alevel' and t.code = 'Topic 1'
   and t.title like 'Development of practical skills%'
   and t.sort_order = 1;
