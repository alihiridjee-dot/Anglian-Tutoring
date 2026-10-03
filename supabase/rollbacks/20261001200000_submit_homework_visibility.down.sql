-- Rollback for 20261001200000_submit_homework_visibility.sql: puts back the
-- live definitions of 1 Oct 2026. Submitting no longer checks the sheet is
-- visible, and students can insert submissions directly again.
begin;

create or replace function public.submit_homework_answers(
  _resource_id uuid,
  _answers jsonb,
  _notes text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  _uid uuid := auth.uid();
  _submission_id uuid;
begin
  if _uid is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1 from public.resources r where r.id = _resource_id and r.kind = 'homework'
  ) then
    raise exception 'That homework does not exist';
  end if;

  if exists (
    select 1 from public.homework_submissions s
    where s.resource_id = _resource_id and s.student_id = _uid
  ) then
    raise exception 'You have already submitted this homework';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a
    where not exists (
      select 1 from public.homework_questions q
      where q.id = (a ->> 'question_id')::uuid and q.resource_id = _resource_id
    )
  ) then
    raise exception 'An answer refers to a question that is not on this homework';
  end if;

  insert into public.homework_submissions (resource_id, student_id, notes, submitted_at)
  values (_resource_id, _uid, nullif(btrim(coalesce(_notes, '')), ''), now())
  returning id into _submission_id;

  insert into public.homework_answers (submission_id, question_id, answer_text)
  select
    _submission_id,
    (a ->> 'question_id')::uuid,
    nullif(btrim(coalesce(a ->> 'answer_text', '')), '')
  from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a;

  delete from public.homework_drafts
   where student_id = _uid and resource_id = _resource_id;

  return _submission_id;
end;
$function$;

drop policy if exists "hs student submit" on public.homework_submissions;
create policy "hs student submit"
  on public.homework_submissions for insert to authenticated
  with check (
    ((select auth.uid()) = student_id)
    or private.has_role((select auth.uid()), 'tutor'::app_role)
  );

commit;
