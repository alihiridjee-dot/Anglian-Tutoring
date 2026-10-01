-- #10, second step: withdraw homework_questions.mark_scheme from browser reads.
--
-- Apply only after the app that reads mark schemes through
-- homework_mark_schemes() (20261001104228_fix_first_access_rules.sql) is
-- live. The app before it selects this column directly and would be refused.
--
-- Revoking one column is a no-op while a table-wide SELECT grant exists, so
-- drop the table grant and re-grant every other column. INSERT, UPDATE and
-- DELETE stay granted (RLS still limits them to tutors). Marking reads with
-- the service role and is unaffected.
revoke select on public.homework_questions from authenticated;
revoke select on public.homework_questions from anon;
grant select (
  id, resource_id, position, prompt, marks, answer_type,
  image_path, image_name, spec_point_id, created_at
) on public.homework_questions to authenticated;
