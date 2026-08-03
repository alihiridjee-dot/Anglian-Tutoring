-- How much work one spec point is, relative to its siblings.
--
-- The planner used to size a topic's band and cut it into weeks by COUNTING
-- spec points, which assumes they are interchangeable units. They are not:
-- across a real spec the heaviest point is several times the lightest, so
-- "three points this week" was anywhere between half an hour and three hours.
--
-- Measured offline from the board's own specification (see
-- scripts/spec-weights/) and reviewable by a tutor. Only the RATIOS within one
-- course matter — the planner uses them to divide a fixed number of weeks — so
-- the unit is deliberately unnamed and is not calibrated to clock time.
--
-- Defaults to 1 so any tree without measured weights behaves exactly as before.
-- Values are loaded separately from the reviewed CSVs:
--   bun run scripts/spec-weights/load-weights.ts --write
alter table public.spec_points
  add column if not exists weight numeric(5,2) not null default 1
    check (weight > 0);

comment on column public.spec_points.weight is
  'Relative teaching/learning load of this spec point within its course. 1 = an average-ish point; see scripts/spec-weights/. Ratios only — not minutes.';
