-- Deleting an account left its Stripe subscription alive and billing forever.
--
-- The chain is: delete auth.users -> profiles cascades -> subscriptions and
-- stripe_customers cascade (both FK profiles(id)). Nothing in that chain talks
-- to Stripe, and once the subscriptions row is gone the live subscription is
-- invisible to this system entirely. That is how
-- sub_1TuAqZPfYW4Jomqj3LKtSTfq survived its owner and kept renewing.
--
-- There is no account-deletion code path in the app to patch: deletions are
-- done by hand in the Supabase dashboard. So the capture has to be a database
-- trigger, which is the only thing guaranteed to be in the path.
--
-- Postgres cannot call Stripe (and should not try — a failed HTTP call must
-- never roll back or hang a deletion), so this is an outbox: the trigger
-- records what needs cancelling, and the stripe-reconcile edge function drains
-- the queue.

create table if not exists public.stripe_cancellation_queue (
  id                      uuid primary key default gen_random_uuid(),
  stripe_subscription_id  text not null,
  stripe_customer_id      text,
  -- Deliberately NOT a foreign key: this row must outlive the user it is about.
  subject_user_id         uuid,
  subject_email           text,
  reason                  text not null default 'account_deleted',
  plan                    text,
  enqueued_at             timestamptz not null default now(),
  processed_at            timestamptz,
  attempts                integer not null default 0,
  last_error              text
);

-- One outstanding request per subscription; a retry updates the existing row.
create unique index if not exists stripe_cancellation_queue_pending_uniq
  on public.stripe_cancellation_queue (stripe_subscription_id)
  where processed_at is null;

comment on table public.stripe_cancellation_queue is
  'Outbox of Stripe subscriptions that must be cancelled because the account '
  'they belong to was deleted. Written by the profiles BEFORE DELETE trigger, '
  'drained by the stripe-reconcile edge function. Service role only.';

alter table public.stripe_cancellation_queue enable row level security;
-- No policies: nothing but the service role may see or touch this.

create or replace function private.enqueue_stripe_cancellations()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
begin
  -- BEFORE DELETE on profiles, so the subscriptions rows that are about to
  -- cascade away are still visible here. Catch both sides: the student the
  -- plan covers, and the payer (a parent may hold the plan for a child).
  insert into public.stripe_cancellation_queue
    (stripe_subscription_id, stripe_customer_id, subject_user_id, subject_email, plan, reason)
  select distinct
    s.stripe_subscription_id,
    s.stripe_customer_id,
    old.id,
    (select u.email from auth.users u where u.id = old.id),
    s.plan,
    'account_deleted'
  from public.subscriptions s
  where (s.student_id = old.id or s.user_id = old.id)
    and s.stripe_subscription_id is not null
    and coalesce(s.status, '') not in ('canceled', 'incomplete_expired')
  on conflict (stripe_subscription_id) where processed_at is null
  do update set
    enqueued_at = now(),
    reason      = 'account_deleted',
    last_error  = null;

  return old;
end;
$function$;

drop trigger if exists profiles_enqueue_stripe_cancellations on public.profiles;
create trigger profiles_enqueue_stripe_cancellations
  before delete on public.profiles
  for each row
  execute function private.enqueue_stripe_cancellations();
