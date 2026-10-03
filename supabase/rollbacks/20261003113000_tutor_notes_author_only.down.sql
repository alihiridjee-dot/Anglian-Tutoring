-- Rollback for 20261003113000_tutor_notes_author_only.sql: back to the single
-- FOR ALL policy exactly as it is live before (20260923081108). This reopens
-- M-31: any tutor can again change or delete another tutor's note.
begin;

drop policy if exists "stn staff read" on public.student_tutor_notes;
drop policy if exists "stn author insert" on public.student_tutor_notes;
drop policy if exists "stn author update" on public.student_tutor_notes;
drop policy if exists "stn author delete" on public.student_tutor_notes;

drop policy if exists "stn tutor" on public.student_tutor_notes;
create policy "stn tutor" on public.student_tutor_notes
  for all to authenticated
  using (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    or private.has_role((select auth.uid()), 'admin'::public.app_role)
  )
  with check (
    author_id = (select auth.uid())
    and (
      private.has_role((select auth.uid()), 'tutor'::public.app_role)
      or private.has_role((select auth.uid()), 'admin'::public.app_role)
    )
  );

commit;
