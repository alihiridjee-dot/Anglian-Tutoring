-- Undo 20261119234634_enrolment_self_writes_fenced: the two policies as they
-- stood live on 19 Nov 2026, and the table-wide update grant.

drop policy if exists "enrolments self insert" on public.student_enrolments;
create policy "enrolments self insert" on public.student_enrolments
  as permissive for insert to authenticated
  with check (student_id = (select auth.uid()));

drop policy if exists "enrolments self delete" on public.student_enrolments;
create policy "enrolments self delete" on public.student_enrolments
  as permissive for delete to authenticated
  using (student_id = (select auth.uid()));

-- Clears the column grants, then gives back the table privilege.
revoke update on public.student_enrolments from authenticated;
grant update on public.student_enrolments to authenticated;
