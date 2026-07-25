-- Remove complimentary (grandfathered) access
--
-- Grandfathering was a one-time bridge for students carried over from the old
-- sign-up flow: an 'active' subscription with plan='grandfathered' and no Stripe
-- object behind it. That bridge is retired. Every student now pays through
-- Stripe like everyone else, so these manually-granted rows are deleted.
--
-- Deleting the row (rather than flipping its status) drops the student to "no
-- subscription", which fails private.student_has_access() and raises the
-- frontend paywall — exactly the state a lapsed account should be in until they
-- resubscribe through Stripe.

delete from public.subscriptions where plan = 'grandfathered';
