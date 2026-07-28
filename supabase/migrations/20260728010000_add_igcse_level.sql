-- iGCSE is its own qualification, not a flavour of GCSE. It arrived modelled as
-- board = edexcel_intl at level = gcse, which left it invisible in the level
-- picker and would collide the day a second exam board's iGCSE is added
-- (Cambridge sits the same qualification). Promote it to a level of its own.
--
-- Split from the data move because Postgres will not let a new enum value be
-- used in the transaction that adds it.
alter type public.level add value if not exists 'igcse';
