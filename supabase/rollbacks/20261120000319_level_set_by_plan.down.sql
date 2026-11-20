-- Rollback for 20261120000319_level_set_by_plan.sql: a student may change
-- their own level again, as before. Nothing else was changed.

drop trigger if exists level_set_by_plan on public.profiles;
drop function if exists private.keep_level_while_plan_live();
