-- DOWN for migrations/20260921221948_homework_review_gate.sql.
--
-- Kept out of supabase/migrations on purpose: the CLI applies everything in
-- that folder, in order, and a rollback must only ever run by hand.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -f supabase/rollbacks/20260921221948_homework_review_gate.down.sql
--
-- Running this publishes every held and not-yet-published sheet at once: the
-- gate is the only thing keeping them from students. Deploy the app version
-- that stops passing `_publish_at` first, or generation will fail on the
-- missing argument. Hand-made student groups are deleted with their tables.

begin;

drop policy if exists "resources read scoped" on public.resources;
create policy "resources read scoped" on public.resources
  for select to authenticated
  using (
    (select private.has_role((select auth.uid()), 'tutor'::public.app_role))
    or ((subject)::text in (select unnest(private.my_content_subjects())))
  );

drop function if exists public.save_homework_mark_draft(uuid, jsonb, text);
drop function if exists public.homework_points_with_sheet(uuid[]);

drop table if exists public.student_group_members;
drop table if exists public.student_groups;

-- The writer goes back to its previous signature. Body as in
-- migrations/20260917120000_generated_homework_server_only.sql — re-run that
-- file after this one to restore it.
drop function if exists public.ensure_generated_homework(
  uuid, text, public.subject, public.level, jsonb, uuid, public.board, timestamptz
);

drop index if exists public.resources_review_queue_idx;
alter table public.resources
  drop column if exists reviewed_at,
  drop column if exists reviewed_by,
  drop column if exists publish_at,
  drop column if exists review_status;

notify pgrst, 'reload schema';

commit;
