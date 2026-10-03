-- Rollback for 20261003120000_plan_descriptions_one_session_a_week.sql. Run by hand.
--
-- Puts back the descriptions live before 3 Oct 2026 (2 live sessions per
-- subject per week), on every price list.

update public.packages p
set description = v.description
from (
  values
    ('weekly_1',  '2 live sessions a week.'),
    ('weekly_2',  '4 live sessions a week.'),
    ('weekly_3',  '6 live sessions a week.'),
    ('monthly_1', '8 live sessions a month.'),
    ('monthly_2', '16 live sessions a month.'),
    ('monthly_3', '24 live sessions a month.'),
    ('termly_1',  '24 live sessions a term.'),
    ('termly_2',  '48 live sessions a term.'),
    ('termly_3',  '72 live sessions a term.')
) as v(tier, description)
where p.tier = v.tier
  and p.description is distinct from v.description;
