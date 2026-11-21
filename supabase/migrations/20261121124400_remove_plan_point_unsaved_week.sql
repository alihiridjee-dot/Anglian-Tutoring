-- A point can be removed from a week the student has not opened yet.
--
-- remove_plan_point read `_row.origin` in its last line. `_row` is only filled
-- in when the week has a saved plan, so for a week with none (any week still
-- to come that the programme has not cut) PL/pgSQL refused with
-- 'record "_row" is not assigned yet', and the tutor's Remove, and the first
-- half of every Move out of such a week, failed with that raw message. It was
-- raised on production on 18 Nov 2026, and found again on 21 Nov by a trial of
-- the plan change log.
--
-- The origin is now kept in its own variable, set when the point is found.
-- Nothing else changes: the body is otherwise production's on 21 Nov 2026
-- (from 20260922104641_planner_tutor_overrides.sql). Same signature, security
-- and grants. Idempotent.
--
-- Rollback: supabase/rollbacks/20261121124400_remove_plan_point_unsaved_week.down.sql

create or replace function public.remove_plan_point(_student_id uuid, _subject subject, _spec_point_id uuid, _week_start date, _note text default null::text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  _this_monday date := date_trunc('week', now() at time zone 'Europe/London')::date;
  _plan_id uuid;
  _row record;
  _origin text;
  _removed boolean := false;
begin
  if not plan_override_caller_is_tutor() then
    raise exception 'Only a tutor can change a student''s plan.' using errcode = '42501';
  end if;
  if extract(isodow from _week_start) <> 1 then
    raise exception 'Choose a Monday.' using errcode = '22023';
  end if;
  if _week_start < _this_monday then
    raise exception 'Past weeks are history and cannot be changed.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from spec_points sp join topics t on t.id = sp.topic_id
    where sp.id = _spec_point_id and t.subject = _subject
  ) then
    raise exception 'That spec point is not on this subject.' using errcode = '23514';
  end if;

  select id into _plan_id from student_weekly_plans
    where student_id = _student_id and subject = _subject and week_start = _week_start
    for update;
  if _plan_id is not null then
    select * into _row from student_weekly_plan_points
      where plan_id = _plan_id and spec_point_id = _spec_point_id for update;
    if found then
      _origin := _row.origin::text;
      if _row.done_at is not null or plan_point_has_work(_student_id, _spec_point_id, _week_start) then
        return jsonb_build_object('removed', false, 'blocked', false, 'reason', 'worked',
          'origin', _origin);
      end if;
      delete from student_weekly_plan_points
        where plan_id = _plan_id and spec_point_id = _spec_point_id;
      _removed := true;
    end if;
  end if;

  insert into student_plan_overrides (student_id, subject, spec_point_id, kind, week_start, note, created_by)
  values (_student_id, _subject, _spec_point_id, 'remove', _week_start, nullif(trim(_note), ''), auth.uid())
  on conflict (student_id, subject, spec_point_id, kind, (coalesce(week_start, date '0001-01-01')))
  do update set note = excluded.note, created_by = excluded.created_by, created_at = now();

  return jsonb_build_object('removed', _removed, 'blocked', true, 'reason', null,
    'origin', case when _removed then _origin end);
end
$function$;
