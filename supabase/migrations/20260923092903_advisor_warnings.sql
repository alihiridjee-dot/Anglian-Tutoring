-- Clears three warnings from the Supabase security advisor. No behaviour change.
--
-- `private.touch_student_tutor_note` (20260923081108) was created without a
-- pinned search_path. Its body only calls now(), which lives in pg_catalog and
-- resolves under any path, so an empty one costs nothing.
--
-- `enforce_plan_overrides` and `enforce_plan_override_course` (20260922104641)
-- are trigger functions that kept the default EXECUTE grant, so the API listed
-- them as RPCs that anyone, signed in or not, could call. A direct call only
-- errors ("trigger functions can only be called as triggers"), but nothing
-- should reach them that way. Postgres checks EXECUTE when a trigger is
-- created, not when it fires, so both triggers keep firing for every role.
--
-- `curriculum_coverage` is flagged too and is left alone: the signed-out
-- pricing page calls it, and 20260728000000 grants anon on purpose.

alter function private.touch_student_tutor_note() set search_path = '';

revoke execute on function public.enforce_plan_overrides() from public, anon, authenticated;
revoke execute on function public.enforce_plan_override_course() from public, anon, authenticated;
