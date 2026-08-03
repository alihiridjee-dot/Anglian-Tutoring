-- 'weekly' and 'tri_monthly' are the pre-subject-count flat-rate tiers,
-- superseded by weekly_1/2/3 and termly_1/2/3. Their Stripe prices and
-- products have been archived (prices and products cannot be deleted in
-- Stripe once a price exists; archiving is the terminal state). Neither
-- price ever had a subscription against it.
--
-- 'monthly' is deliberately NOT dropped: Stripe subscription
-- sub_1TuAqZPfYW4Jomqj3LKtSTfq is still active on price
-- price_1TuAO3PfYW4JomqjJDS9eBAV with metadata tier = 'monthly'. That
-- subscription has no row in this database and its user
-- (6f25367c-b367-483b-91f9-f6923bdb797a) no longer exists in profiles.
-- Resolve that orphan before retiring the tier.
delete from packages
where tier in ('weekly', 'tri_monthly')
  and active = false;
