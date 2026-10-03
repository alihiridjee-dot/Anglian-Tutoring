-- S-12 and S-15: how marked homework is totalled and published.
--
-- S-12. publish_homework_marks totalled every question now on the sheet, so a
-- question a tutor added after students had handed in counted against work
-- that never had it: full marks on a 2-mark sheet became 25% once a 6-mark
-- question was added. A submission is now scored out of the questions it was
-- set: those on the sheet when the student handed in, plus any they answered.
-- The student's page sends a row for every question, blanks included, so a
-- blank still counts against them; a question present at hand-in counts even
-- if a hand-rolled request left its row out.
--
-- Started from the live definition (pg_get_functiondef, 1 Oct 2026); only the
-- totals query changes.
create or replace function public.publish_homework_marks(_submission_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _sub public.homework_submissions;
  _staged public.homework_ai_marks;
  _awarded numeric;
  _total numeric;
  _pct numeric;
  _title text;
begin
  if auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not private.has_role(auth.uid(), 'tutor'::public.app_role)
     and not private.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only tutors or admins may publish marks'
      using errcode = '42501';
  end if;

  select * into _sub
    from public.homework_submissions
   where id = _submission_id
     for update;

  if not found then
    raise exception 'No such submission';
  end if;

  if _sub.graded_at is not null then
    return false;
  end if;

  select * into _staged
    from public.homework_ai_marks
   where submission_id = _submission_id;

  if not found then
    return false;
  end if;

  perform set_config('app.publishing_marks', 'on', true);

  update public.homework_answers a
     set awarded_marks = least(greatest(coalesce((m ->> 'marks')::numeric, 0), 0), q.marks),
         feedback = nullif(btrim(coalesce(m ->> 'feedback', '')), '')
    from jsonb_array_elements(coalesce(_staged.marks, '[]'::jsonb)) m
    join public.homework_questions q
      on q.id = (m ->> 'question_id')::uuid
   where a.submission_id = _submission_id
     and a.question_id = q.id;

  select coalesce(sum(a.awarded_marks), 0), coalesce(sum(q.marks), 0)
    into _awarded, _total
    from public.homework_questions q
    left join public.homework_answers a
      on a.question_id = q.id and a.submission_id = _submission_id
   where q.resource_id = _sub.resource_id
     and (a.id is not null or q.created_at <= _sub.submitted_at);

  _pct := case when _total > 0 then round((_awarded / _total) * 100) else null end;

  update public.homework_submissions
     set score_pct = _pct,
         grade = case
           when _pct is null then null
           when _pct >= 90 then '9' when _pct >= 80 then '8'
           when _pct >= 70 then '7' when _pct >= 60 then '6'
           when _pct >= 50 then '5' when _pct >= 40 then '4'
           when _pct >= 30 then '3' when _pct >= 20 then '2'
           else '1' end,
         feedback = coalesce(feedback, nullif(btrim(coalesce(_staged.summary, '')), '')),
         graded_at = now()
   where id = _submission_id;

  select r.title into _title
    from public.resources r
   where r.id = _sub.resource_id;

  insert into public.notifications (user_id, type, title, body, link, submission_id)
  values (
    _sub.student_id,
    'homework_marked',
    'Your homework has been marked',
    coalesce(_title, 'Homework') ||
      case when _pct is not null then ' — ' || _pct::text || '%' else '' end,
    '/homework/' || _sub.resource_id::text,
    _submission_id
  );

  return true;
end;
$function$;

-- S-15. "Confirm & publish" saved each answer's marks, then the submission, as
-- separate requests. If the second failed, the student already saw the tutor's
-- per-question marks with no grade, and at release_at the publisher wrote the
-- AI's marks over them; a timer run between the two mixed the AI's
-- per-question marks with the tutor's total. This writes both in one
-- transaction, holding the submission row (FOR UPDATE, as the publisher does),
-- so the publisher either ran first and is overwritten, or runs after and
-- finds the work already graded.
--
-- _marks: [{ question_id, marks (null = unmarked), feedback }]. Marks are
-- clamped to each question's maximum, the publisher's rule. Feedback is kept
-- as sent, so an empty string records a comment the tutor deliberately cleared
-- (M-4) rather than reading as "never written".
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

revoke all on function public.confirm_homework_marks(uuid, jsonb, numeric, text) from public;
revoke all on function public.confirm_homework_marks(uuid, jsonb, numeric, text) from anon;
grant execute on function public.confirm_homework_marks(uuid, jsonb, numeric, text) to authenticated;
