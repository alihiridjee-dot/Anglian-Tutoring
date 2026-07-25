-- Billing feedback now covers cancel, not delete.
--
-- Deletion was removed: cancelling is the only way to end a plan, and it is
-- gated behind the feedback form (as pausing already was). So the action a
-- feedback row can describe is 'pause' or 'cancel' — no 'delete'.
--
-- Safe to swap the check outright: no rows reference 'delete' (deletion never
-- shipped a completed flow), verified before applying.

alter table public.billing_feedback
  drop constraint if exists billing_feedback_action_check;

alter table public.billing_feedback
  add constraint billing_feedback_action_check check (action in ('pause', 'cancel'));
