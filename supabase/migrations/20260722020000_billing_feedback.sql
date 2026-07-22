-- Billing feedback — why a family paused or deleted a plan.
--
-- Two product rules land here together:
--
--   1. Pausing and deleting a plan are now gated behind a short feedback form
--      (the client won't submit the action until a reason is chosen). This table
--      is where that reason lands, so the tutor/business can see why families
--      step away rather than losing the signal to Stripe alone.
--
--   2. Only a PARENT may pause or delete — never a self-paying student. The
--      insert policy enforces that from the data (profiles.role), matching the
--      server check in stripe-checkout. A student's own /billing view never
--      reaches this table.
--
-- The row is a record of intent captured at submit time; the actual Stripe state
-- change still flows through stripe-checkout + the webhook as before. Keeping the
-- feedback here (rather than only in Stripe's cancellation_details) means pause —
-- which has nowhere to attach a reason in Stripe — is captured too.

create table if not exists public.billing_feedback (
  id uuid primary key default gen_random_uuid(),
  -- The parent who submitted it (the payer). Defaulted from the JWT so the
  -- client cannot attribute feedback to someone else.
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- The student whose plan the feedback is about.
  student_id uuid not null references public.profiles (id) on delete cascade,
  -- Which lifecycle action prompted it.
  action text not null check (action in ('pause', 'delete')),
  -- A coarse bucket chosen from a fixed list in the form, plus free text.
  reason_category text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists billing_feedback_student_idx on public.billing_feedback (student_id);

alter table public.billing_feedback enable row level security;

-- INSERT: only a linked parent, writing as themselves, about a child they are
-- actually linked to. This is the data-level twin of the server's parent-only
-- guard on pause/delete — a self-paying student cannot write here.
create policy "billing feedback insert linked parent" on public.billing_feedback
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'parent'::public.profile_role
    )
    and exists (
      select 1 from public.parent_student_links l
      where l.parent_id = auth.uid() and l.student_id = billing_feedback.student_id
    )
  );

-- SELECT: the submitter can see their own; tutors see everything (the point of
-- collecting it). Students deliberately cannot read it.
create policy "billing feedback read own" on public.billing_feedback
  for select to authenticated
  using (auth.uid() = user_id);

create policy "billing feedback read tutor" on public.billing_feedback
  for select to authenticated
  using (private.has_role(auth.uid(), 'tutor'::public.app_role));
