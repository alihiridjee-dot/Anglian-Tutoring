# Products catalogue and money ledger

Migration: `supabase/migrations/20261108120000_commercial_ledger.sql`
Types: `src/lib/billing/commerce.ts`
Test: `scripts/test-commercial-ledger-db.ts`
Rollback: `supabase/rollbacks/20261108120000_commercial_ledger.down.sql`

## Where it stands

It is **dark**. Nothing in the app, the paywall or the Stripe webhook uses it.
Today's plans (`packages`) and today's access (`subscriptions`, written only by
`stripe-webhook`) are unchanged. See [STRIPE_SETUP.md](STRIPE_SETUP.md) for those.

## The model

- **Catalogue.** `products` are what can be bought. Each one unlocks
  `product_modules`: a level and a subject, optionally one board (null = any
  board). `product_prices` say what it costs, in pence. `access_tiers` rank the
  kinds of access. Clients (and logged-out visitors) can read only what is on
  sale. Nobody but the service role writes the catalogue.
- **Accounts.** One `billing_accounts` row per payer: a student paying for
  themselves, or a parent. This is the tenant. Every ledger row belongs to one.
- **Ledger.** `ledger_transactions` holds one row per request (who, what, the
  idempotency key). `ledger_entries` holds the money movements, numbered 1, 2,
  3 per account, each with the balance after it.
- **Access.** `product_entitlements` (a view, for the payer) lists purchases
  that have not been refunded, with the window of access each one bought.
  `my_entitlements()` gives the same windows to the student they cover, with no
  amounts, so a child sees what they can use, not what a parent paid.

A balance is **store credit** in pence and never goes below zero.

| What happened                    | Entries                            | Balance |
| -------------------------------- | ---------------------------------- | ------- |
| Stripe took £49.99 for a product | card_payment +4999, purchase −4999 | same    |
| Credit spent on a product        | purchase −4999                     | down    |
| Credit given (goodwill, voucher) | credit_grant +1000                 | up      |
| Refund to credit                 | refund +4999                       | up      |
| Refund to card                   | refund +4999, card_refund −4999    | same    |
| Correction                       | adjustment ±n (memo required)      | ±n      |

## The rules

1. Nobody writes the ledger tables directly, not even the service role. Every
   row comes from the `ledger_*` functions.
2. Nothing in the ledger is ever changed or deleted. Fix a mistake with a
   refund or an adjustment.
3. One idempotency key per account = one transaction. Same key, same request:
   you get the first result back with `replayed = true`. Same key, different
   request: refused. A Stripe id is recorded once only; sent again under another
   key, the same payment replays. Signed-in callers' keys are stored as
   `client:<key>` and the service role can't use that prefix, so a client can
   never take a key the webhook needs.
4. Postings on one account run one at a time (a row lock on the account).
   Purchases and refunds for one student and product also queue, so two payers
   buying for one child at once can't both get the same month.
5. A price never changes. Switch it off and add a new one. A product that has
   been sold keeps all its modules (you can add more).
6. Clients can only spend their own credit, for themselves or a linked child.
   Everything else is service role only.
7. A purchase never covers a tutor account.

Deleting a profile closes its billing account (`owner_id` becomes null) and
keeps the history. Ledger rows hold no names or emails, only amounts, product
ids and the uuid of the student a purchase covered.

## The functions

All return `(transaction_id, balance_pence, replayed)`.

| Function                      | Who          | Does                                   |
| ----------------------------- | ------------ | -------------------------------------- |
| `ledger_purchase_with_credit` | signed-in    | Spends the caller's credit on a price  |
| `my_credit_balance`           | signed-in    | The caller's balance in pence          |
| `my_entitlements`             | signed-in    | The caller's access (no amounts)       |
| `ledger_record_card_purchase` | service role | Records a card payment Stripe took     |
| `ledger_grant_credit`         | service role | Adds credit                            |
| `ledger_refund`               | service role | Refunds one purchase in full, once     |
| `ledger_adjust`               | service role | Signed correction with a reason        |
| `private.ledger_audit()`      | SQL only     | Lists any account whose history is off |

From an edge function, key on the Stripe object that was paid (the invoice),
not on the event, so retries and a second event for the same invoice replay
instead of double-posting. A recurring price needs the period Stripe charged
for; that is the access recorded, so renewals follow Stripe's calendar exactly:

```ts
const line = invoice.lines.data[0];
const { data, error } = await db.rpc("ledger_record_card_purchase", {
  p_payer_id: payerId,
  p_student_id: studentId,
  p_price_id: priceId,
  p_amount_pence: invoice.amount_paid,
  p_external_ref: invoice.id,
  p_idempotency_key: `stripe:${invoice.id}`,
  p_period_start: new Date(line.period.start * 1000).toISOString(),
  p_period_end: new Date(line.period.end * 1000).toISOString(),
});
```

A one-off price takes no period: a pass starts when the student's current
access to that product ends, and "for good" starts now.

## Testing

```bash
PGLITE_MODULE=<path>/@electric-sql/pglite/dist/index.js bun scripts/test-commercial-ledger-db.ts
```

It runs on a throwaway in-memory Postgres; no live data. It can't test two
connections racing (PGlite has one connection), so the locks in rule 4 are
checked by reading, not by a test.

## Not done yet

- Applying it to the live database.
- Regenerating `src/integrations/supabase/types.ts` once it is applied.
- Wiring: the Stripe webhook recording payments, a page showing credit, and
  content RLS calling `private.student_has_module`.
- Partial refunds (only full refunds exist).
- A payment that reaches the webhook after the payer's or student's profile
  was deleted is refused ("no account to bill"). The webhook should log it and
  answer 200, or Stripe retries for days. Account deletion cancels Stripe
  subscriptions first, so this should be rare.
