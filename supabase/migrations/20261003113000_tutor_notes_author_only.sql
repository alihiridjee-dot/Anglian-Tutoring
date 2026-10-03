-- M-31: only a note's author can change or delete it.
--
-- "stn tutor" (20260923081108) is one FOR ALL policy. Its USING lets any staff
-- member in, and its WITH CHECK only asks that author_id be the caller, so
-- another tutor could delete a colleague's private note, or rewrite it and
-- take it over as their own (an update that sets author_id to themselves
-- passed). The student record says only the author can edit or remove a note.
--
-- Split by command: every staff member still reads every note, and writes a
-- new one only as themselves; updating and deleting need the caller to be the
-- author. The app already says "This note couldn't be changed from your
-- account." when a write matches nothing.
--
-- Idempotent; safe in either order with the app (it only offers edit and
-- delete on the caller's own notes).

drop policy if exists "stn tutor" on public.student_tutor_notes;
drop policy if exists "stn staff read" on public.student_tutor_notes;
drop policy if exists "stn author insert" on public.student_tutor_notes;
drop policy if exists "stn author update" on public.student_tutor_notes;
drop policy if exists "stn author delete" on public.student_tutor_notes;

create policy "stn staff read" on public.student_tutor_notes
  for select to authenticated
  using (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    or private.has_role((select auth.uid()), 'admin'::public.app_role)
  );

create policy "stn author insert" on public.student_tutor_notes
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      private.has_role((select auth.uid()), 'tutor'::public.app_role)
      or private.has_role((select auth.uid()), 'admin'::public.app_role)
    )
  );

create policy "stn author update" on public.student_tutor_notes
  for update to authenticated
  using (
    author_id = (select auth.uid())
    and (
      private.has_role((select auth.uid()), 'tutor'::public.app_role)
      or private.has_role((select auth.uid()), 'admin'::public.app_role)
    )
  )
  with check (
    author_id = (select auth.uid())
    and (
      private.has_role((select auth.uid()), 'tutor'::public.app_role)
      or private.has_role((select auth.uid()), 'admin'::public.app_role)
    )
  );

create policy "stn author delete" on public.student_tutor_notes
  for delete to authenticated
  using (
    author_id = (select auth.uid())
    and (
      private.has_role((select auth.uid()), 'tutor'::public.app_role)
      or private.has_role((select auth.uid()), 'admin'::public.app_role)
    )
  );
