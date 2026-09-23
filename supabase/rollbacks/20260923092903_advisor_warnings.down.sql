-- DOWN for migrations/20260923092903_advisor_warnings.sql.
--
-- Kept out of supabase/migrations on purpose: the CLI applies everything in
-- that folder, in order, and a rollback must only ever run by hand.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -f supabase/rollbacks/20260923092903_advisor_warnings.down.sql
--
-- Restores the unpinned search_path and the default EXECUTE grants the three
-- functions had before, which brings the advisor warnings back.

begin;

alter function private.touch_student_tutor_note() reset search_path;

grant execute on function public.enforce_plan_overrides() to public, anon, authenticated;
grant execute on function public.enforce_plan_override_course() to public, anon, authenticated;

commit;
