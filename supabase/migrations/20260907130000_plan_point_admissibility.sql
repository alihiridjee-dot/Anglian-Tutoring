-- A week may only hold work the programme has actually reached.
--
-- Reviews were being assigned for topics the student had never been taught. The
-- review lane's own logic was sound — a point with assessed evidence has an FSRS
-- card, a card has a next review, the review gets scheduled — but evidence can
-- exist ahead of teaching: a weekly quiz tagged across several topics writes a
-- score for every point it touches, so one quiz spanning topics 3 and 6 handed
-- those points cards, and the queue began revising material the spine had not
-- introduced. Nothing in the chain ever asked whether the spine had got there.
--
-- Worse, once such a row existed nothing could remove it. `save_weekly_plan`
-- deletes only points with no completion, no carry marker and an automatic
-- origin, so a stale review the student had ticked off — or that had been
-- carried once — was immune to every automatic path in the application and had
-- to be deleted by hand.
--
-- This trigger is the authoritative half of the fix (the application enforces
-- the same rule in `planner/admissibility.ts`, for messages a person can act
-- on). It is deliberately duplicated: the module gives the good error, this
-- gives the guarantee, and it holds for anything that reaches PostgREST
-- directly — including the write path nobody has thought of yet.
--
-- Two rules:
--
--   1. The point must be on the plan's own course. Never checked anywhere
--      before: a student who changed board kept their old board's spec points
--      in the plan, referencing a curriculum they are no longer sitting.
--      Applies to every origin, a tutor's included.
--   2. For automatic origins, the point's topic must have opened by the plan's
--      week. Hand-picked origins ('student', 'tutor') are exempt on purpose —
--      a tutor whose student is doing topic 6 at school this term must be able
--      to assign topic 6 today, and explicit carry/add-practice controls are
--      documented human overrides to spacing.
--
-- The test reads `student_program_plan.pacing`: the spine the student has
-- *acknowledged*, not a live recomputation. That is the correct reference. When
-- an exam date moves, the application shows the resulting shift and the student
-- accepts it — until they do, the programme they are living by is the stored
-- one, and it is the one an assignment has to answer to.
--
-- SECURITY DEFINER so the check cannot be dodged by a caller who simply cannot
-- read the pacing row; a failed read must not read as "nothing to enforce".

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

revoke all on function public.enforce_plan_point_admissible() from public, anon, authenticated;

drop trigger if exists plan_point_admissible on public.student_weekly_plan_points;
create trigger plan_point_admissible
  before insert or update of spec_point_id, origin, plan_id
  on public.student_weekly_plan_points
  for each row
  execute function public.enforce_plan_point_admissible();

-- The lateral scan above runs once per inserted row; a week is at most 200 of
-- them, and this keeps the programme lookup off a sequential scan.
create index if not exists student_program_plan_student_subject_idx
  on public.student_program_plan (student_id, subject);

-- Version 3 marks "admissibility is enforced in the database". The application
-- reads this before offering to apply an assessment-driven replacement, so a
-- client running against an older database does not assume the guard is there.
create or replace function public.assessment_scheduler_version()
returns integer language sql stable security invoker set search_path = public
as $$ select 3 $$;
revoke all on function public.assessment_scheduler_version() from public, anon;
grant execute on function public.assessment_scheduler_version() to authenticated;

-- ---------------------------------------------------------------------------
-- A weekly plan must be for a course the student actually sits.
--
-- The trigger above compares a spec point's topic to the PLAN's board, which
-- makes it blind to a plan that is wholly wrong: an all-AQA plan holding AQA
-- points agrees with itself and passes. That check is about a plan's internal
-- consistency; this one is about whether the plan should exist at all.
--
-- It was not hypothetical. `student_program_plan` is keyed on (student_id,
-- subject) and carries no board or level, while `student_weekly_plans` carries
-- both, and nothing tied them together — so an Edexcel GCSE chemistry student
-- had one week built from the AQA tree, generator rationale and all, sitting
-- between three correct Edexcel weeks.
--
-- Fails open where there is nothing to compare against: a student with no
-- enrolment row for the subject yet, or no level on their profile, is not
-- blocked. The rule refuses a contradiction, never an absence.
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

  if _enrolments = 0 then
    return new;
  end if;

  select count(*) into _matching
  from student_enrolments e
  where e.student_id = new.student_id
    and e.subject = new.subject
    and e.board = new.board;

  if _matching = 0 then
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

revoke all on function public.enforce_plan_matches_enrolment() from public, anon, authenticated;

drop trigger if exists plan_matches_enrolment on public.student_weekly_plans;
create trigger plan_matches_enrolment
  before insert or update of student_id, subject, board, level
  on public.student_weekly_plans
  for each row
  execute function public.enforce_plan_matches_enrolment();

create index if not exists student_enrolments_student_subject_board_idx
  on public.student_enrolments (student_id, subject, board);
