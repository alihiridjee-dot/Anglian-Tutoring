-- Billing feedback insert: manager, not parent-only.
--
-- The first cut of this policy (20260722020000) allowed only a linked parent to
-- record pause/delete feedback. But management is link-based: a student with NO
-- linked parent manages their own plan on their own platform, and must be able
-- to record the same feedback when they pause or delete it. The moment a parent
-- is linked, control (and this insert) moves to the parent.
--
-- Mirrors assertCanManage() in the stripe-checkout edge function:
--   • a linked parent of the student                     → allowed
--   • the student themselves, with no linked parent       → allowed
--   • a linked (even self-paying) student                 → denied

drop policy if exists "billing feedback insert linked parent" on public.billing_feedback;

create policy "billing feedback insert manager" on public.billing_feedback
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (
      exists (
        select 1 from public.parent_student_links l
        where l.parent_id = auth.uid() and l.student_id = billing_feedback.student_id
      )
      or (
        auth.uid() = billing_feedback.student_id
        and not exists (
          select 1 from public.parent_student_links l
          where l.student_id = billing_feedback.student_id
        )
      )
    )
  );
