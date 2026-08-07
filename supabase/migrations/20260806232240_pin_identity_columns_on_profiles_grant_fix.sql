-- Actually withdraw write access to the identity columns on `profiles`.
--
-- The previous migration tried
--
--   revoke update (role, student_invite_code, enrolled_courses) ... from authenticated;
--
-- and it did nothing. `authenticated` held a **table-level** UPDATE grant, which
-- covers every column present and future; a column-level REVOKE cannot subtract
-- from it. Postgres accepts the statement and changes nothing, so the hole this
-- was meant to close — a student PATCHing their own `enrolled_courses` to widen
-- the subject scope of the content policies, or their `role` to reach the
-- parent-only `link_child_by_code` — stayed open.
--
-- The fix is to drop the table grant and re-issue exactly the columns the app
-- writes. That also changes the default for anything added to this table later:
-- a new column is unwritable until someone deliberately grants it, which is the
-- direction a schema holding children's records should fail in.
--
-- Confirm with, and do not trust the absence of an error instead of:
--
--   select column_name, privilege_type
--   from information_schema.column_privileges
--   where table_schema='public' and table_name='profiles'
--     and grantee='authenticated' and privilege_type='UPDATE';

revoke update on public.profiles from authenticated;
grant update (display_name, phone, school, level, onboarding_completed_at)
  on public.profiles to authenticated;
