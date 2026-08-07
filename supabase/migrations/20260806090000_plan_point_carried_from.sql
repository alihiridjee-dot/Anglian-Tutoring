-- Carrying a point into next week used to overwrite its lane: `origin` was set
-- to 'carried_over', which is not a lane at all, so a shaky *core* point left
-- the core column and reappeared in the neutral "Added by you" box. Since the
-- year plan divides each spec point into exactly one week, it never came back.
--
-- `origin` now keeps meaning the lane (core / focus / student / tutor) and the
-- fact that a point was carried is recorded separately, as the Monday of the
-- week it came from. Nullable: a point that was planned, not carried, has none.
--
-- Existing 'carried_over' rows are left alone — their lane is genuinely unknown,
-- and guessing one retroactively would move work between columns under students
-- mid-week. They keep reading as "Added by you" until they age out.
alter table public.student_weekly_plan_points
  add column if not exists carried_from date;

comment on column public.student_weekly_plan_points.carried_from is
  'Monday of the week this point was carried forward from; null if it was planned for this week. The lane stays in `origin`.';
