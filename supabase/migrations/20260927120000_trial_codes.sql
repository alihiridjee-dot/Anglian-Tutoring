-- Free-trial codes: the landing page's pop-up emails a visitor a code of their
-- own, and that code unlocks a 14-day trial at Checkout.
--
--   request   the trial-code edge function (public) makes one code per email
--             address and sends it through Resend. Asking again re-sends the
--             same code rather than minting another.
--   claim     stripe-checkout checks the code, starts Checkout with
--             trial_period_days = 14 and records the session here, so one code
--             cannot run two Checkouts at once. An abandoned session expires
--             and the code can be claimed again.
--   redeem    stripe-webhook stamps redeemed_at on checkout.session.completed.
--
-- The address itself is never stored — only a SHA-256 of it, enough to answer
-- "has this address had a code?". Children use this site, and a table of
-- their email addresses collected before they have an account is not
-- something we need to hold.
--
-- No RLS policies on purpose: only the service role (the edge functions) reads
-- or writes this table. A browser that could read it could collect codes.
--
-- Idempotent. Rollback: supabase/rollbacks/20260927120000_trial_codes.down.sql

begin;

create table if not exists public.trial_codes (
  code                 text primary key,
  email_hash           text not null unique,
  created_at           timestamptz not null default now(),
  -- The last time the code was emailed. Drives the per-address cooldown and
  -- the hourly cap on sends.
  last_sent_at         timestamptz not null default now(),
  -- The Checkout Session currently holding the code, and who opened it.
  checkout_session_id  text,
  claimed_by           uuid references auth.users (id) on delete set null,
  -- The student the trial covers.
  student_id           uuid references auth.users (id) on delete set null,
  redeemed_at          timestamptz
);

create index if not exists trial_codes_last_sent_at_idx on public.trial_codes (last_sent_at);

alter table public.trial_codes enable row level security;
revoke all on public.trial_codes from anon, authenticated;

commit;
