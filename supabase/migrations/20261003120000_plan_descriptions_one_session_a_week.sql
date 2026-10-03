-- S-9: plan descriptions say 1 live session per subject per week.
--
-- PR #83 changed the landing page to 1 live session per subject a week, but
-- packages.description (20260721120000, copied to the iGCSE rows in
-- 20260728030000) still said 2: "2 live sessions a week", "8 live sessions a
-- month", "24 live sessions a term". The plan step shows this text beside the
-- price, so a family read one number on the landing page and double it at
-- payment.
--
-- Wording approved by Ali (3 Oct 2026): "4 live sessions a month, 1 a week".
-- Weeks per cycle are the landing page's 4 a month and 12 a term. Prices and
-- Stripe price ids don't change. Every price list (general and iGCSE) gets the
-- same text; the inactive ks3 row is left alone.
--
-- Idempotent: rows already holding the new text are skipped.

update public.packages p
set description = v.description
from (
  values
    ('weekly_1',  '1 live session a week.'),
    ('weekly_2',  '2 live sessions a week.'),
    ('weekly_3',  '3 live sessions a week.'),
    ('monthly_1', '4 live sessions a month, 1 a week.'),
    ('monthly_2', '8 live sessions a month, 2 a week.'),
    ('monthly_3', '12 live sessions a month, 3 a week.'),
    ('termly_1',  '12 live sessions a term, 1 a week.'),
    ('termly_2',  '24 live sessions a term, 2 a week.'),
    ('termly_3',  '36 live sessions a term, 3 a week.')
) as v(tier, description)
where p.tier = v.tier
  and p.description is distinct from v.description;
