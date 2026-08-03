-- Billing feedback: a third action, and a manager rule that includes the payer.
--
-- Two changes that belong together, because both come from the same gap on the
-- billing page: a self-paying student with a linked parent could neither cancel
-- their own plan nor drop a single subject from it.
--
-- 1. action gains 'remove_subject'. Dropping one subject from a plan is now a
--    real, gated flow (stripe-checkout: remove_subjects) rather than something
--    a family can only achieve by cancelling outright, so it captures a reason
--    the same way pause and cancel do.
--
-- 2. The insert policy stops being link-only. It previously mirrored the old
--    assertCanManage: a linked parent, or a student with NO linked parent. That
--    left the payer out — a student who pays with their own card and later links
--    a parent was locked out of managing (and recording feedback about) a
--    subscription they were still being charged for.
--
--    The rule on both sides is now: the PAYER always, or a linked parent, or an
--    unlinked student on their own plan. Nobody is charged with no way to stop.
--
-- Safe to swap the check outright: no rows can reference 'remove_subject' yet,
-- and the constraint only widens.

alter table public.billing_feedback
  drop constraint if exists billing_feedback_action_check;

alter table public.billing_feedback
  add constraint billing_feedback_action_check
  check (action in ('pause', 'cancel', 'remove_subject'));

-- Mirrors assertCanManage() in the stripe-checkout edge function:
--   • the payer of the student's subscription              → allowed
--   • a linked parent of the student                       → allowed
--   • the student themselves, with no linked parent        → allowed
--   • a linked student on someone else's card              → denied
drop policy if exists "billing feedback insert manager" on public.billing_feedback;

create policy "billing feedback insert manager" on public.billing_feedback
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (
      -- the payer, whoever's card the plan actually sits on
      exists (
        select 1 from public.subscriptions s
        where s.student_id = billing_feedback.student_id
          and s.user_id = auth.uid()
      )
      or exists (
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
