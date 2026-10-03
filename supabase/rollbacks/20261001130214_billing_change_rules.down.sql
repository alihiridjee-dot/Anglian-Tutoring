-- Rollback for 20261001130214_billing_change_rules.sql. Redeploy the
-- stripe-checkout from before it first: the current one takes leases and
-- enrols through these functions. Restores the live billing_feedback insert
-- policy of 1 Oct 2026, which lets an unlinked student record feedback on a
-- plan someone else pays for (reopening S-2 on that side).
drop policy if exists "billing feedback insert manager" on public.billing_feedback;
create policy "billing feedback insert manager" on public.billing_feedback
  for insert to authenticated
  with check (
    (auth.uid() = user_id)
    and (
      (exists (
        select 1 from public.subscriptions s
         where s.student_id = billing_feedback.student_id and s.user_id = auth.uid()
      ))
      or (exists (
        select 1 from public.parent_student_links l
         where l.parent_id = auth.uid() and l.student_id = billing_feedback.student_id
      ))
      or (
        auth.uid() = student_id
        and not exists (
          select 1 from public.parent_student_links l
           where l.student_id = billing_feedback.student_id
        )
      )
      or private.has_role(auth.uid(), 'tutor'::public.app_role)
      or private.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );

drop function if exists public.apply_enrolment_change(uuid, jsonb, text[]);
drop function if exists public.release_billing_lease(uuid);
drop function if exists public.take_billing_lease(uuid);
drop table if exists public.billing_change_leases;
