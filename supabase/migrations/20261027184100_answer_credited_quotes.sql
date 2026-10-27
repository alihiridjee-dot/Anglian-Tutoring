-- The words that earned each mark, kept for the student to see.
--
-- Since #296 the marker quotes the student's own words for every mark it
-- gives, and `stageMarks` checks each quote is really in the answer. Those
-- quotes were then thrown away. The marked sheet now draws them under the
-- highlighter with a tick, so they are kept:
--
--   homework_ai_marks.credited  {question_id: [{quote, point, marks}]}, the
--     verified quotes, written by mark-homework only. It is its own column
--     so a tutor saving a draft (`save_homework_mark_draft`, which rewrites
--     `marks`) never drops them.
--   homework_answers.credited   that question's list, copied across when the
--     marks are published (`publish_homework_marks`) or a tutor confirms them
--     (`confirm_homework_marks`). Readable under the answer's own RLS.
--
-- A tutor who changes a mark gets the quotes copied all the same; the sheet
-- shows them only while their marks add up to the mark awarded, so a changed
-- mark never sits beside ticks that disagree with it.
--
-- Both functions are the live definitions as of 27 Oct with one line added
-- each (`credited = …`). CREATE OR REPLACE keeps their grants.
begin;

alter table public.homework_ai_marks add column if not exists credited jsonb;
alter table public.homework_answers add column if not exists credited jsonb;

comment on column public.homework_ai_marks.credited is
  'Verified quotes per question: {question_id: [{quote, point, marks}]}. Written by mark-homework.';
comment on column public.homework_answers.credited is
  'The student''s words that earned this answer''s marks: [{quote, point, marks}]. Copied on publish/confirm.';

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
         feedback = nullif(btrim(coalesce(m ->> 'feedback', '')), ''),
         credited = _staged.credited -> q.id::text
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
    'Your task has been marked',
    coalesce(_title, 'Task') ||
      case when _pct is not null then ' — ' || _pct::text || '%' else '' end,
    '/homework/' || _sub.resource_id::text,
    _submission_id
  );

  return true;
end;
$function$;

create or replace function public.confirm_homework_marks(_submission_id uuid, _marks jsonb, _score_pct numeric, _feedback text)
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
         feedback = btrim(coalesce(m ->> 'feedback', '')),
         credited = (select s.credited -> q.id::text
                       from public.homework_ai_marks s
                      where s.submission_id = _submission_id)
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

commit;
