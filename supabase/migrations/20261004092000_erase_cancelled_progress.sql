-- Erasing a family's cancelled progress after 7 days (PR 3 of the subject-pause work).
--
-- Ali's rule (3–4 Oct 2026): when a family cancels the plan, the student's
-- progress is kept for 7 days after the plan ends. Coming back in that time
-- is a pause, and everything picks up where it stopped. After 7 days it is
-- erased for good. Removing one subject does the same for that subject only.
-- Pausing, a failed payment, or Stripe closing a plan whose card failed never
-- erases anything: only a family's own cancellation is stamped cancelled_at
-- (20261004090000_subject_pauses).
--
-- Erased (Ali, 4 Oct): the subject's year plan and weekly plans with their
-- ticks, check-ins and weekly tutor notes; term plans; the tutor's changes to
-- the plan; quiz attempts; task submissions with their answers, marks and
-- feedback, and drafts; review history, due dates and confidence ratings;
-- and the subject's pause records. A cancelled plan also takes the tutor's
-- notes about the student and the learning profile.
--
-- Kept: the account (login, name, school, photo, subject list), parent links
-- and invites, billing records, messages, live lesson attendance and groups,
-- and the AI usage log. Each of those has its own rules.
--
-- No files are involved. Tasks have been typed answers since 20260909150000,
-- and on 4 Oct 2026 no submission carried a file and nothing sat under
-- resources/submissions/. If uploads ever come back, their files must be
-- removed through the Storage API too: storage.objects refuses SQL deletes.
--
-- It runs nightly. A stop is erased once its cancellation is at least 7 full
-- days old, so a family always has the 7 days the screens promise.

-- Everything one student has for one subject, across every board and level
-- (a student may have changed course).
create or replace function private.erase_subject_progress(p_student_id uuid, p_subject public.subject)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _points uuid[];
  _topics uuid[];
begin
  select coalesce(array_agg(t.id), '{}') into _topics
  from public.topics t where t.subject = p_subject;
  select coalesce(array_agg(sp.id), '{}') into _points
  from public.spec_points sp where sp.topic_id = any (_topics);

  -- Weekly plans take their points, check-ins and weekly tutor notes with them.
  delete from public.student_weekly_plans where student_id = p_student_id and subject = p_subject;
  delete from public.student_term_plans where student_id = p_student_id and subject = p_subject;
  delete from public.student_program_plan where student_id = p_student_id and subject = p_subject;
  delete from public.student_plan_overrides where student_id = p_student_id and subject = p_subject;

  delete from public.student_spec_point_reviews
   where student_id = p_student_id and spec_point_id = any (_points);
  delete from public.student_spec_point_schedule
   where student_id = p_student_id and spec_point_id = any (_points);
  delete from public.student_spec_point_confidence
   where student_id = p_student_id and spec_point_id = any (_points);
  delete from public.student_topic_confidence
   where student_id = p_student_id and topic_id = any (_topics);

  delete from public.mcq_attempts a
   using public.mcq_sets m
   where a.set_id = m.id and a.user_id = p_student_id
     and (m.subject = p_subject
       or m.spec_point_id = any (_points)
       or exists (select 1 from public.mcq_questions q
                  where q.set_id = m.id and q.spec_point_id = any (_points)));

  -- Submissions take their answers, AI marks and notifications with them.
  delete from public.homework_submissions h
   using public.resources r
   where h.resource_id = r.id and h.student_id = p_student_id
     and (r.subject = p_subject
       or r.spec_point_id = any (_points)
       or exists (select 1 from public.resource_spec_points l
                  where l.resource_id = r.id and l.spec_point_id = any (_points)));
  delete from public.homework_drafts d
   using public.resources r
   where d.resource_id = r.id and d.student_id = p_student_id
     and (r.subject = p_subject
       or r.spec_point_id = any (_points)
       or exists (select 1 from public.resource_spec_points l
                  where l.resource_id = r.id and l.spec_point_id = any (_points)));

  delete from public.student_subject_pauses where student_id = p_student_id and subject = p_subject;
end;
$function$;

revoke all on function private.erase_subject_progress(uuid, public.subject) from public, anon, authenticated;

-- Erase every family cancellation that is at least 7 days old. Returns how
-- many stops were erased.
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

select cron.unschedule('erase-cancelled-progress')
 where exists (select 1 from cron.job where jobname = 'erase-cancelled-progress');

select cron.schedule(
  'erase-cancelled-progress',
  '35 3 * * *',
  $cron$ select private.erase_cancelled_progress(); $cron$
);
