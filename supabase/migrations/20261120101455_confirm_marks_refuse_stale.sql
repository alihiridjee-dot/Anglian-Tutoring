-- Two tutors publishing the same paper no longer overwrite each other unseen.
--
-- `confirm_homework_marks` locked the row and then wrote its marks, comment
-- and "marked by" whatever had happened since the tutor opened the paper. A
-- second tutor (or the same one in another tab) working from a list loaded
-- before the first one published replaced the first one's marks and comments,
-- and neither of them was told.
--
-- Two optional parameters at the end:
--
--   _seen_graded_at  the paper's graded_at as the tutor's list loaded it
--                    (null for one that was not published yet)
--   _check_seen      true to have that checked
--
-- With the check on, a paper a person has published since it was loaded is
-- refused with the reason the tutor is shown, errcode 40001 (the row changed
-- underneath you), and the marking queue reloads it so they see the other
-- marks. "A person" is graded_by: only this function sets it. The 24-hour
-- clock (`publish_homework_marks`) publishes the marker's proposal and leaves
-- graded_by empty, so a tutor still checking that proposal when the clock ran
-- out is not refused: their marks replace the marker's, as before.
--
-- A caller that sends neither parameter (a page loaded before this change)
-- saves exactly as before. PostgREST cannot choose between two overloads that
-- both fit a call, so the old four-argument signature is dropped and the new
-- one created in the same transaction. The body is otherwise the live one
-- (20261119225700, checked against production 20 Nov 2026). Same security,
-- search_path and grants.
--
-- Rollback: supabase/rollbacks/20261120101455_confirm_marks_refuse_stale.down.sql
begin;

drop function if exists public.confirm_homework_marks(uuid, jsonb, numeric, text);

create or replace function public.confirm_homework_marks(
  _submission_id uuid,
  _marks jsonb,
  _score_pct numeric,
  _feedback text,
  _seen_graded_at timestamptz default null,
  _check_seen boolean default false
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
  -- A person published it after this tutor loaded it: say so rather than
  -- write over their marks. The release clock publishing it meanwhile leaves
  -- graded_by empty and is not refused.
  if _check_seen
     and _sub.graded_by is not null
     and _sub.graded_at is distinct from _seen_graded_at then
    raise exception 'Someone else marked this paper while you had it open. Reopen it to see their marks.'
      using errcode = '40001';
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

revoke all on function public.confirm_homework_marks(uuid, jsonb, numeric, text, timestamptz, boolean)
  from public, anon;
grant execute on function public.confirm_homework_marks(uuid, jsonb, numeric, text, timestamptz, boolean)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
