-- The orphaned subscription that blocked this (sub_1TuAqZPfYW4Jomqj3LKtSTfq,
-- belonging to a user hard-deleted from auth.users) has been cancelled in
-- Stripe, and the monthly price and product archived. Nothing is on this tier
-- any more.
--
-- Root cause of that orphan is NOT fixed by this migration: deleting a user
-- cascades away their subscriptions row but never cancels the Stripe
-- subscription, so it keeps renewing invisibly. Tracked separately.
delete from packages
where tier = 'monthly'
  and active = false;
