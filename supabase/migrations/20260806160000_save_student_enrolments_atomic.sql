-- One transaction for "these are my subjects".
--
-- Onboarding wrote the subject choice as three separate statements from the
-- browser: delete the de-selected enrolment rows, upsert the selected ones,
-- then update profiles.enrolled_courses to match. Any failure between them
-- leaves the two disagreeing, and they are not merely redundant -- RLS reads
-- `enrolled_courses` to decide what curriculum content a student may see. A
-- student whose enrolment rows saved but whose profile update didn't is a
-- student who has paid and can see nothing, with no error to explain it.
--
-- Signup is exactly when this is most likely to bite: a class onboarding
-- together is a burst of these on the slowest, least-warmed part of the app.
create or replace function public.save_student_enrolments(_subjects jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _keep text[];
begin
  if _uid is null then
    raise exception 'not signed in';
  end if;
  if jsonb_typeof(coalesce(_subjects, '[]'::jsonb)) <> 'array' then
    raise exception 'subjects must be an array';
  end if;
  if jsonb_array_length(coalesce(_subjects, '[]'::jsonb)) > 20 then
    raise exception 'too many subjects';
  end if;

  select coalesce(array_agg(distinct e->>'subject'), '{}'::text[])
  into _keep
  from jsonb_array_elements(coalesce(_subjects, '[]'::jsonb)) e;

  -- Drop de-selected subjects: narrowing from three to one must actually
  -- remove access to the other two, which an upsert alone would not do.
  delete from student_enrolments
  where student_id = _uid
    and (_keep = '{}'::text[] or subject::text <> all (_keep));

  insert into student_enrolments (student_id, subject, board)
  select _uid, (e->>'subject')::subject, (e->>'board')::board
  from jsonb_array_elements(coalesce(_subjects, '[]'::jsonb)) e
  on conflict (student_id, subject) do update set board = excluded.board;

  -- The denormalised list many reads (and the content RLS) still use. Moving in
  -- the same transaction as the rows above is the whole point of this function.
  update profiles set enrolled_courses = _keep where id = _uid;
end
$$;

revoke all on function public.save_student_enrolments(jsonb) from public;
grant execute on function public.save_student_enrolments(jsonb) to authenticated;
