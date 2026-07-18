# Stripe Setup

Everything in the app is built and tested; what's left needs your Stripe keys,
which never come near this repo or a chat window. Work in **test mode**
(`sk_test_…`) until the whole flow works end to end.

## The model in one paragraph

A subscription names the **student it covers** (`subscriptions.student_id`)
separately from the **account that pays** (`subscriptions.user_id`). Access is
asked as _"does this student have a live subscription"_ —
`private.student_has_access(student_id)` — never _"is this user a payer"_. That
is what lets a student pay for themselves **or** a linked parent pay for them,
with one definition of access either way.

The **`stripe-webhook` function is the only writer of `subscriptions`**. RLS
gives `authenticated` no INSERT or UPDATE on that table on purpose: a client
that could write it could grant itself free access. Nothing else may write it.

## 1. Create the products

```bash
bun add stripe
```

Put your key in `.env` (Stripe dashboard → Developers → API keys):

```
STRIPE_SECRET_KEY=sk_test_...
```

Then:

```bash
bun --env-file=.env scripts/stripe-seed.ts
```

This creates three products with recurring GBP prices — Weekly £19.99/week,
Monthly Saver £49.99/month, Tri-monthly £139.99/3 months — and writes each price
id onto `packages.stripe_price_id`. It's re-runnable: prices are looked up by
`lookup_key` and reused, never duplicated.

> Stripe prices are immutable. To change what a plan costs, create a new price
> in the dashboard and re-point `stripe_price_id` at it. Editing `price_pence`
> only changes the number the app displays — it does **not** change the charge.

## 2. The functions

Both are **already deployed** to the project:

| Function | `verify_jwt` | Why |
| --- | --- | --- |
| `stripe-checkout` | `true` | Called by signed-in users; the platform rejects unsigned callers before the code runs |
| `stripe-webhook` | `false` | **Deliberate.** Stripe calls it unauthenticated, so there's no JWT to check — the Stripe signature authenticates it instead, which is why step 3 is not optional |

Redeploying by hand (only needed if you edit them):

```bash
supabase functions deploy stripe-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
```

They need secrets, which are **not** read from `.env` — set them on the project.
Dashboard → Project Settings → Edge Functions → Secrets, or:

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set APP_URL=http://localhost:5173   # your real origin in prod
```

`APP_URL` is where Stripe sends the browser back after checkout. Pointing it at
`localhost:5173` is fine for testing — the browser makes that redirect, so it
only has to resolve on *your* machine. The webhook is a separate call from
Stripe's servers to Supabase, and is unaffected.

## 3. Wire up the webhook

Stripe dashboard → Developers → Webhooks → Add endpoint:

- **URL**: `https://peohauhwquuvghrpmotf.supabase.co/functions/v1/stripe-webhook`
- **Events**: `checkout.session.completed`,
  `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`

Copy the signing secret it gives you, then:

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

Without this secret the function rejects every request — including real ones.
It is the only thing standing between a stranger and free access, so never
disable the check to "get it working".

## 4. Test it

Locally you can forward events instead of exposing an endpoint:

```bash
stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook
```

Card `4242 4242 4242 4242`, any future expiry, any CVC.

Walk it: sign up → verify email → profile setup → pick a plan → pay. The
success page polls `my_access_state()` until the webhook lands (usually a second
or two), then drops you on the dashboard. If it spins for 15 seconds, the
webhook isn't arriving — check `supabase functions logs stripe-webhook`.

## 5. Going live

Swap `sk_test_…` for `sk_live_…`, re-run the seed script (it creates live-mode
products — Stripe keeps test and live entirely separate), add a live-mode webhook
endpoint, and set the live `STRIPE_WEBHOOK_SECRET` and a production `APP_URL`.

## Grandfathered accounts

Students who signed up before the paywall carry `plan = 'grandfathered'` with
`status = 'active'` and no Stripe subscription, so they keep working. Find them
with:

```sql
select * from public.subscriptions where plan = 'grandfathered';
```

Migrate them onto real subscriptions when you're ready; deleting the row simply
sends that student to `/onboarding/plan` on their next visit.

## Known gap

The paywall is currently enforced at the **route guard**, not in RLS. An unpaid
student cannot reach the dashboard UI, but someone with their own JWT could
still query the curriculum tables directly. Closing that means adding
`private.student_has_access()` to the RLS policies on `resources`, `topics`,
`spec_points`, `mcq_sets` and friends — deliberately deferred, and worth doing
before the paywall protects anything you'd mind losing.
