-- Rollback for 20261006174500_notify_when_tutor_publishes.sql. Run by hand.
--
-- Puts confirm_homework_marks back exactly as it was live on 6 Oct 2026: a
-- tutor's "Confirm & publish" stops notifying the student, and only the timer
-- does. Notifications already sent are left alone. Safe to run twice.
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
end;
$function$;
