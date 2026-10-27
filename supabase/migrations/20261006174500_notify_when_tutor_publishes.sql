-- A tutor's "Confirm & publish" tells the student their task is marked.
--
-- Two things publish a mark. The timer (publish_homework_marks, half an hour
-- after hand-in) sends the student "Your task has been marked". A tutor
-- confirming or correcting the marks (confirm_homework_marks) sent nothing, so
-- work a tutor published inside the half hour, or marked by hand after the AI
-- couldn't, reached the student with no notification at all.
--
-- It now sends the timer's notification, with the same wording and link, when
-- it is the one that publishes. "Update mark" on work already published still
-- changes the mark without a second notification. The two can't both send one
-- for the same work: each holds the submission row (FOR UPDATE), and only the
-- one that finds it unpublished notifies.
--
-- Started from the live definition (pg_get_functiondef, 6 Oct 2026, the body
-- 20261001123732 wrote); only the notification is new.
create or replace function public.confirm_homework_marks(
  _submission_id uuid,
  _marks jsonb,
  _score_pct numeric,
  _feedback text
)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _sub public.homework_submissions;
  _title text;
begin
  if not private.has_role((select auth.uid()), 'tutor'::public.app_role)
     and not private.has_role((select auth.uid()), 'admin'::public.app_role) then
    raise exception 'Only tutors or admins may publish marks' using errcode = '42501';
  end if;
  if _score_pct is not null and (_score_pct < 0 or _score_pct > 100) then
    raise exception 'Score must be between 0 and 100';
  end if;

  select * into _sub
    from public.homework_submissions
   where id = _submission_id
     for update;
  if not found then
    raise exception 'No such submission';
  end if;

  update public.homework_answers a
     set awarded_marks = case
           when nullif(btrim(coalesce(m ->> 'marks', '')), '') is null then null
           else least(greatest((m ->> 'marks')::numeric, 0), q.marks)
         end,
         feedback = btrim(coalesce(m ->> 'feedback', ''))
    from jsonb_array_elements(coalesce(_marks, '[]'::jsonb)) m
    join public.homework_questions q
      on q.id = (m ->> 'question_id')::uuid
     and q.resource_id = _sub.resource_id
   where a.submission_id = _submission_id
     and a.question_id = q.id;

  update public.homework_submissions
     set score_pct = _score_pct,
         grade = case
           when _score_pct is null then null
           when _score_pct >= 90 then '9' when _score_pct >= 80 then '8'
           when _score_pct >= 70 then '7' when _score_pct >= 60 then '6'
           when _score_pct >= 50 then '5' when _score_pct >= 40 then '4'
           when _score_pct >= 30 then '3' when _score_pct >= 20 then '2'
           else '1' end,
         feedback = nullif(btrim(coalesce(_feedback, '')), ''),
         graded_by = (select auth.uid()),
         graded_at = now(),
         tutor_reviewed_at = now()
   where id = _submission_id;

  -- This call published it, so the student hears now, as from the timer.
  -- `_sub` was read before the update above: on "Update mark" it already
  -- carries a graded_at, and nothing is sent.
  if _sub.graded_at is null then
    select r.title into _title
      from public.resources r
     where r.id = _sub.resource_id;

    insert into public.notifications (user_id, type, title, body, link, submission_id)
    values (
      _sub.student_id,
      'homework_marked',
      'Your task has been marked',
      coalesce(_title, 'Task') ||
        case when _score_pct is not null then ' — ' || _score_pct::text || '%' else '' end,
      '/homework/' || _sub.resource_id::text,
      _submission_id
    );
  end if;
end;
$function$;
