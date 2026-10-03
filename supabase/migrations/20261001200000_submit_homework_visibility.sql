-- M-21: a student can hand in only a sheet they can see.
--
-- submit_homework_answers is SECURITY DEFINER, so row-level security on
-- resources never applied to it, and it checked only that the id was a
-- homework sheet. Given an id, a student could hand in a sheet held for
-- review, another subject's sheet, or anything after their plan had lapsed,
-- and each one went to the AI marker. Worse, once a submission existed, the
-- "has a submission" clause of the resources policy made the held sheet
-- readable to them.
--
-- The check below is the resources policy's own rule, applied to the caller:
-- a tutor, or a student whose paid subjects include the sheet's subject, on a
-- sheet that is approved or past its publish time. It deliberately leaves out
-- two parts of that policy. Parents are out: they can read their child's
-- sheets but never hand one in. The "has a submission" clause is out too,
-- because that clause is what the submission would create.
--
-- The rest of the body is the live definition (pg_get_functiondef, 1 Oct 2026)
-- unchanged.
--
-- Separately, the "hs student submit" policy let a student INSERT into
-- homework_submissions directly, around this function and its checks. The app
-- never does (it always calls this function, and delete-account uses the
-- service role), so the policy goes.
--
-- Idempotent; safe in either order with the app.

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

  -- The resources policy's rule, for the caller (see the header).
  if not exists (
    select 1 from public.resources r
    where r.id = _resource_id
      and (
        private.has_role(_uid, 'tutor'::public.app_role)
        or (
          r.subject::text = any (private.student_paid_subjects(_uid))
          and (
            r.review_status = 'approved'
            or (r.review_status = 'to_review' and (r.publish_at is null or r.publish_at <= now()))
          )
        )
      )
  ) then
    raise exception 'That homework is not open to you';
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

revoke all on function public.submit_homework_answers(uuid, jsonb, text) from public, anon;
grant execute on function public.submit_homework_answers(uuid, jsonb, text) to authenticated, service_role;

drop policy if exists "hs student submit" on public.homework_submissions;
