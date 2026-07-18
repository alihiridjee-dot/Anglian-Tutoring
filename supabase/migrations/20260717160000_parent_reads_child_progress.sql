-- Linked parents can read their child's quiz attempts and session attendance,
-- matching what they can already see for homework. A parent_student_links row
-- IS the grant (identity-agnostic gating).
create policy "attempts parent reads linked" on public.mcq_attempts
  for select to authenticated
  using (exists (
    select 1 from public.parent_student_links l
    where l.parent_id = auth.uid() and l.student_id = mcq_attempts.user_id
  ));

create policy "attendees parent reads linked" on public.session_attendees
  for select to authenticated
  using (exists (
    select 1 from public.parent_student_links l
    where l.parent_id = auth.uid() and l.student_id = session_attendees.user_id
  ));
