-- The summer a student sits their exams, asked on the first setup step.
--
-- Nothing asked it before. The planner guessed the nearest June, which is only
-- right in a course's final year: a Year 10 joining in September was planned to
-- an exam nine months away, so a two-year course was squeezed into one and they
-- showed as behind from their first week. Each new subject's plan is now cut to
-- the first Monday of June in this year (`examMondayIn`, src/lib/planner/pacing.ts).
--
-- A year rather than a year group, because a year group goes stale every
-- September. It only seeds a plan: the exact week stays the per-subject
-- `student_program_plan.exam_date`, and plans that already exist are left as
-- they are. Null means never asked, which is everyone who signed up before
-- this, and they keep the guess.
--
-- The range only keeps nonsense out. The app ignores a year whose exams have
-- begun or that is further off than a course runs.

alter table public.profiles add column if not exists exam_year smallint
  constraint profiles_exam_year_range check (exam_year between 2000 and 2100);

-- `20260806232240_pin_identity_columns_on_profiles_grant_fix` dropped the
-- table-level UPDATE grant, so a new column arrives unwritable until it is
-- granted by name. "profiles self update" already holds the write to the
-- caller's own row, and nothing reads this column to decide access.
grant update (exam_year) on public.profiles to authenticated;
