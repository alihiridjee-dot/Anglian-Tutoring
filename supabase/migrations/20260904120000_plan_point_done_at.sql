-- "What to do now" — the student ticks a spec point off their week.
--
-- Coverage already knows whether a point's homework/quiz was *submitted*, but a
-- week is more than what it can measure: watching the video and reading the
-- spec point leave no trace anywhere. The checklist therefore needs a mark the
-- student sets themselves, and it belongs on the point's row in the plan — one
-- nullable timestamp, so "when" is recorded rather than just "yes".
--
-- No policy changes: the "wpp own" policy is already `for all`, so a student can
-- update their own plan's points, and tutors/parents keep read-only sight of it.
alter table public.student_weekly_plan_points
  add column if not exists done_at timestamptz;
