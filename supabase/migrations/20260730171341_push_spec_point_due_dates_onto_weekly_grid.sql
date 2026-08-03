-- The scheduler ran on FSRS defaults, whose learning steps are 1 and 10 MINUTES.
-- Every card written before the weekly-cadence fix therefore came due within
-- minutes-to-days of being rated, so by the student's next weekly visit almost
-- everything read as overdue and flooded the focus lane. 148 of 165 existing
-- cards carry an interval shorter than a week.
--
-- Push those onto the weekly grid the planner actually runs on: no card is due
-- sooner than a week after the review that scheduled it. Only ever moves a due
-- date later, and only for cards whose interval was under a week — a genuinely
-- long interval, and any card already past that floor, is left alone. Stability
-- and difficulty are untouched; FSRS recomputes those from real elapsed time at
-- the next review.

update student_spec_point_schedule
set
  due = last_review + interval '7 days',
  card = jsonb_set(
    jsonb_set(
      card,
      '{due}',
      to_jsonb(
        to_char((last_review + interval '7 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    ),
    '{scheduled_days}',
    to_jsonb(greatest(7, coalesce((card->>'scheduled_days')::int, 0)))
  ),
  updated_at = now()
where last_review is not null
  and due < last_review + interval '7 days';
