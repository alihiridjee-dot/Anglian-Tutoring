-- Picking a programme up where it stopped (PR 2 of the subject-pause work).
--
-- Ali's rule (3 Oct 2026): when a subject restarts, its programme picks up
-- where it stopped. Promises before the pause stand. What was promised from
-- the week it began is spread again, in the same topic order, from the week
-- the student came back to the exam, so the weeks it was stopped hold no
-- teaching and nothing in them counts as missed. The exam doesn't move, so
-- the rest of the course runs a little fuller each week.
--
-- The planner computes the new calendar (resumeAfterPause, src/lib/planner/
-- topicOrder.ts) and saves it here, the first time the student or a tutor
-- opens the planner after the restart. This checks it the way
-- reorder_student_topics checks a new topic order, with the boundary at the
-- week the pause began rather than this week, and stamps the stop as picked
-- up so it is applied once.

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
      where t.subject = _pause.subject and t.board = _board and t.level = _level) then
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

revoke all on function public.resume_programme_after_pause(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.resume_programme_after_pause(uuid, jsonb, jsonb) to authenticated;
