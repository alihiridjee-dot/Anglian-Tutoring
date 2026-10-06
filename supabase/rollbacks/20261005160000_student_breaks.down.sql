-- Rollback for 20261005160000_student_breaks.sql. Run by hand.
--
-- Removes the hard stop (break weeks can be planned again), the booking
-- functions and the record of breaks, and puts the nightly erase back as
-- 20261004092000 left it. The record is the only history of who booked which
-- break: export it first if it will be wanted. Notifications already sent
-- about breaks stay in people's bells.

drop trigger if exists plan_not_on_a_break on public.student_weekly_plans;
drop trigger if exists plan_point_not_on_a_break on public.student_weekly_plan_points;
drop function if exists private.refuse_planning_on_a_break();

drop function if exists public.end_break(uuid);
drop function if exists public.book_break(uuid, date, integer, text);
drop function if exists private.may_manage_breaks(uuid);

-- Before the table goes: the erase as it was, without the breaks line.
create or replace function private.erase_cancelled_progress()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _due record;
  _stop public.student_subject_pauses%rowtype;
  _subject public.subject;
  _erased integer := 0;
begin
  for _due in
    select distinct p.student_id
    from public.student_subject_pauses p
    where p.ended_at is null
      and p.reason in ('cancelled', 'subject_removed')
      and p.cancelled_at <= now() - interval '7 days'
  loop
    -- Bring the record up to date first. A family who came back in time, or
    -- re-added the subject, has had their stop closed or its stamp cleared.
    perform private.sync_subject_pauses(_due.student_id);

    for _stop in
      select * from public.student_subject_pauses p
      where p.student_id = _due.student_id
        and p.ended_at is null
        and p.reason in ('cancelled', 'subject_removed')
        and p.cancelled_at <= now() - interval '7 days'
      order by p.cancelled_at
    loop
      -- Erasing a cancelled plan takes every subject's stop with it.
      continue when not exists (select 1 from public.student_subject_pauses p where p.id = _stop.id);
      if _stop.reason = 'cancelled' then
        -- The whole plan was cancelled. Never while it gives access again.
        continue when private.student_has_access(_stop.student_id);
        foreach _subject in array enum_range(null::public.subject) loop
          perform private.erase_subject_progress(_stop.student_id, _subject);
        end loop;
        delete from public.student_tutor_notes where student_id = _stop.student_id;
        delete from public.student_learning_profile where student_id = _stop.student_id;
      else
        -- One subject removed. Never while it is paid for or back on the list.
        continue when _stop.subject::text = any (private.student_paid_subjects(_stop.student_id))
          or exists (select 1 from public.student_enrolments e
                     where e.student_id = _stop.student_id and e.subject = _stop.subject);
        perform private.erase_subject_progress(_stop.student_id, _stop.subject);
      end if;
      _erased := _erased + 1;
    end loop;
  end loop;
  return _erased;
end;
$function$;

revoke all on function private.erase_cancelled_progress() from public, anon, authenticated;

drop table if exists public.student_breaks;
