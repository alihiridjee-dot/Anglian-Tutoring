-- Rollback for 20261007094747_plan_tick_from_work: the student ticks by hand
-- again, and every tick is put back as it stood before the migration ran.
drop trigger if exists plan_point_tick_from_work on public.student_weekly_plan_points;
drop trigger if exists plan_ticks_after_attempt on public.mcq_attempts;
drop trigger if exists plan_ticks_after_hand_in on public.homework_submissions;
drop function if exists private.plan_ticks_after_attempt();
drop function if exists private.plan_ticks_after_hand_in();
drop function if exists private.refresh_plan_ticks(uuid, uuid[]);
drop function if exists private.plan_point_tick_from_work();
drop function if exists private.plan_point_tick_state(uuid, uuid, date);

update public.student_weekly_plan_points pp set done_at = b.done_at
from private.plan_ticks_before_20261007094747 b
where b.plan_id = pp.plan_id and b.spec_point_id = pp.spec_point_id;
-- Earned ticks on rows that had no hand tick go too.
update public.student_weekly_plan_points pp set done_at = null
where pp.done_at is not null and not exists (
  select 1 from private.plan_ticks_before_20261007094747 b
  where b.plan_id = pp.plan_id and b.spec_point_id = pp.spec_point_id);
drop table if exists private.plan_ticks_before_20261007094747;
