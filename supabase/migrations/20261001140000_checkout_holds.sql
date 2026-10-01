-- One open Checkout per student.
--
-- stripe-checkout refuses a second plan by looking at public.subscriptions, but
-- that row is only written by the webhook after a payment completes. Until then
-- nothing stopped a second Checkout for the same student: the child paying on
-- the plan page while the parent pays from the Parent Portal, a second tab, or
-- a forgotten Checkout page paid later. Both payments went through, the webhook
-- kept one row per student, and the other subscription billed on unseen.
--
--   checkout_holds   the Checkout Session currently open for a student.
--                    stripe-checkout expires the previous one before opening a
--                    new one, and refuses if that one has just been paid but
--                    the webhook hasn't recorded the plan yet. stripe-webhook
--                    clears the row when the session completes.
--
-- No RLS policies on purpose: only the service role (the edge functions) reads
-- or writes this table.
--
-- Idempotent. Rollback: supabase/rollbacks/20261001140000_checkout_holds.down.sql

begin;

create table if not exists public.checkout_holds (
  student_id           uuid primary key references auth.users (id) on delete cascade,
  checkout_session_id  text not null,
  payer_id             uuid not null references auth.users (id) on delete cascade,
  created_at           timestamptz not null default now()
);

create index if not exists checkout_holds_session_idx on public.checkout_holds (checkout_session_id);

alter table public.checkout_holds enable row level security;
revoke all on public.checkout_holds from anon, authenticated;

commit;
