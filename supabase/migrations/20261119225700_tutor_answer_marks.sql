-- A tutor's own highlights and underlines on a student's answer.
--
-- When a tutor steps in on the AI marker they can now draw over the answer:
-- words under the highlighter (these earned credit) or with a pen line under
-- them (look at this again). The student sees them on the marked sheet.
--
--   homework_answers.tutor_marks  [{from, to, kind, quote}], where from/to are
--     the place in answer_text (in the browser's characters), kind is
--     'highlight' or 'underline', and quote is the words there. Null when the
--     tutor drew nothing.
--
-- They are kept apart from the AI marker's ticks on purpose. `credited` (the
-- marker's verified quotes) is written exactly as before, by the same line,
-- and nothing here reads or changes it. A pen mark carries no marks, so the
-- score stays the number the tutor awards. `publish_homework_marks` (the
-- timer) is untouched: a paper no tutor opens has no pen marks.
--
-- `confirm_homework_marks` is the live definition (20261027184100, checked
-- against production 19 Nov 2026) with one line added: `tutor_marks = …`,
-- read from each question's entry in `_marks`. A caller that sends none (an
-- older page) stores null. Same signature, grants and security.
--
-- Only a tutor can write the column: students have no UPDATE policy on
-- homework_answers, and the function refuses anyone else.
--
-- Rollback: supabase/rollbacks/20261119225700_tutor_answer_marks.down.sql
begin;

alter table public.homework_answers add column if not exists tutor_marks jsonb;

comment on column public.homework_answers.tutor_marks is
  'A tutor''s pen marks on this answer: [{from, to, kind, quote}], kind highlight|underline. Written by confirm_homework_marks.';

-- The marks a tutor sent, with anything malformed left out: at most 200, each
-- a real stretch of the answer with a known pen. A place is counted in the
-- browser's characters, which are never more than the answer's bytes.
create or replace function private.clean_tutor_marks(_marks jsonb, _answer text)
 returns jsonb
 language plpgsql
 immutable
 set search_path to ''
as $function$
declare
  _out jsonb := '[]'::jsonb;
  _m jsonb;
  _from integer;
  _to integer;
  _limit integer := octet_length(coalesce(_answer, ''));
begin
  if _marks is null or jsonb_typeof(_marks) <> 'array' then
    return null;
  end if;

  for _m in select value from jsonb_array_elements(_marks) limit 200 loop
    continue when jsonb_typeof(_m) <> 'object';
    continue when coalesce(_m ->> 'kind', '') not in ('highlight', 'underline');
    continue when coalesce(_m ->> 'from', '') !~ '^[0-9]{1,7}$';
    continue when coalesce(_m ->> 'to', '') !~ '^[0-9]{1,7}$';
    continue when coalesce(jsonb_typeof(_m -> 'quote'), '') <> 'string';

    _from := (_m ->> 'from')::integer;
    _to := (_m ->> 'to')::integer;
    continue when _from >= _to or _to > _limit;

    _out := _out || jsonb_build_object(
      'from', _from,
      'to', _to,
      'kind', _m ->> 'kind',
      'quote', left(_m ->> 'quote', _to - _from)
    );
  end loop;

  return nullif(_out, '[]'::jsonb);
end;
$function$;

revoke all on function private.clean_tutor_marks(jsonb, text) from public, anon, authenticated;

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
                      where s.submission_id = _submission_id),
         tutor_marks = private.clean_tutor_marks(m -> 'tutor_marks', a.answer_text)
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
