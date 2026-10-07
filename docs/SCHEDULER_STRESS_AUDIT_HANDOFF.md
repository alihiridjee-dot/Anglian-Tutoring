# Scheduler stress audit — handoff (2026-10-04/05)

Branch `claude/scheduler-stress-test-ux-fec8f9`, worktree `.claude/worktrees/student-dashboard-3c91bd`.
Baseline was 523 tests; after the fixes 536 pass, tsc and eslint clean, nothing committed yet.
The behaviour changes are summarised at the end of `docs/ASSESSMENT_SCHEDULER.md`.

## What was done

- Read every planner module, DAL, migration and student surface (see the file list in
  the workflow script below).
- Launched a multi-agent audit (Find → Dedup → Verify → Fix → Review). It was stopped
  mid-Find when the usage limit hit. Completed finders are cached and resume for free:

  ```
  Workflow({ scriptPath: "~/.claude/projects/-Users-alihiridjeeasaria-code-Anglian-Tutoring--claude-worktrees-student-dashboard-3c91bd/988a98c5-3a06-4ce2-9713-3ac905911853/workflows/scripts/scheduler-stress-audit-wf_16af688f-449.js", resumeFromRunId: "wf_16af688f-449" })
  ```

  Read that run's `journal.jsonl` first; finders that finished have their findings there.

## Confirmed by hand (not yet fixed)

1. **"Set your exam level in your profile to start planning"** (`src/routes/_authenticated/planner.tsx`)
   is a dead end: `/profile` has no level control. Level is set only at `/onboarding/board`.
2. **No one is ever asked their exam year.** `examMondayFor()` defaults to the nearest June, so a
   Year 10 enrolling in September gets an exam date nine months away and a compressed course.
   Only the date box on the Full plan tab can fix it, and nothing points there.
   **Settled 7 Oct:** sign-up step 1 asks it (`profiles.exam_year`), and a subject's first
   plan runs to that June (`examMondayIn`). Plans made before keep their dates.
3. **Exam date passed = silent dead end**: "0 weeks to go", every week "Nothing assigned", and
   "Catch up now" fails with "this week is at or past the exam date". No pointer to the date box.
4. `queueExamDate` in `StudentPlanner.tsx` silently ignores an out-of-range date (no message).
5. `WeeklyPlanPanel.focusAgain` ignores `addPoints`' return count and toasts success when the
   point was withheld.
6. `WeeklyPlanPanel` EmptyState copy ("Sort a few topics on your planner…") refers to a removed flow.
7. `addPoints` upserts directly, bypassing the 200-point cap that `save_weekly_plan` enforces;
   a later re-cut then throws for ever. "Practise now" on many topics can reach this.
8. Tutor planner: `?week=2026-13-45` passes the regex and reaches `weekKeyToDate`, which throws.
9. `DoNowPanel` ticks have no optimistic update; each tick invalidates the whole planner.

Further hypotheses (state, time zone, DAL, tutor, crash) are in the workflow script's `args`.

## Confirmed LIVE on the test account (2026-10-05, signed in as 123@123.com)

- **Week arrows are unbounded.** 40 taps on "Next week" on the planner's This week tab
  land on 12–18 Jul 2027, three weeks past the 21 Jun 2027 exam, showing "Nothing
  assigned this week — Your next review will appear when it is eligible." Backwards runs
  past the programme start (29 Jun – 5 Jul 2026: "No plan was set for this week").
- **Out-of-range exam date is a silent no-op.** Typing 2020-01-01 into the date box left
  the box showing 2020-01-01, saved nothing, and showed no message.
- **Double-tap on a task tick ends ticked.** Two quick taps on EDEX 1.2 left it ticked
  ("1 of 5 done"); the second tap sent the stale value before the refetch. State restored.
- **Catch-up trickle is one point a week in practice.** Biology: 40 points owed, 37 weeks
  to go, "4 won't fit before exams". Chemistry's rationale said "47 more missed points are
  queued" on 21 Sept and again on 28 Sept. `catchUpBudget` = 0.2 × spine weight (~0.7 on
  Edexcel Bio), so the one-point floor is the whole allowance. The doc's "a month clears in
  about five weeks" did not hold. **Settled in #211 (merged 5 Oct):** when 20% would not fit
  before the exam, each week takes its fair share (owed ÷ weeks left, rounded up), with no
  cap; Ali chose the extra early over an even split, and the doc's maths is corrected. Don't
  re-tune it without asking Ali.
- The biology week of 28 Sept was saved with an empty rationale and a single catch-up
  point (empty cut + `ensureCatchUp`), so the student saw a week with no explanation.
- The planner renders cleanly at phone width; no console errors on any surface visited.

The second workflow run was also stopped mid-Find (six finders running, none finished);
the resume call above still applies but will re-run from scratch.

## Environment notes

- Dev server for this worktree runs on port 8080 (`preview_start` name `anglian-dev`).
- The browser pane held a signed-in session that rendered `/planner` with real data
  (Biology + Chemistry, Edexcel GCSE). The account was NOT identified — confirm it is
  `123@123.com` before any write-path testing.

## State at the end of 2026-10-05

Fixed (all in the working tree, uncommitted): everything listed under
"Stress-test fixes, 2026-10-05" in `docs/ASSESSMENT_SCHEDULER.md`, plus the
dead-end copy fixes (level, subjects, no curriculum, paused, topic editor past
the exam, plain-English comparison and kept-aside panels).

Not fixed — product decisions for Ali:
- ~~**Exam year is never asked.**~~ Settled 7 Oct: Ali chose the onboarding step. It sits
  on step 1 (level and exam board), which can't be skipped. Left for later, by choice:
  a profile setting to change the year (the date box is the only way), the summer
  holiday inside a two-year plan, and a Year 9 option.
- Hand-picked additions ("Practise now", "Retake this topic") cannot be undone by
  the student; the tutor's remove/skip is the only way out.
- Paused-subject history reads "No plan was set" for past weeks; a board change
  does the same. Both need a design.
- ~~`reorder_student_topics` may refuse a reorder when old-course rows are
  protected.~~ **Confirmed and fixed 7 Oct** (20261007103000): after a board or
  level change, every reorder that week failed with "spec point … is on a
  different course". The reorder now re-sends only the current course's points;
  old-course rows with the student's work stay under "Kept aside from this
  week", as the This week re-cut leaves them. This week itself never broke.

Not verified in the browser: every change above compiles and is unit-tested,
but the signed-in test session lives on the `localhost:8080` origin, which
another worktree's dev server took over mid-session. This worktree serves on
`localhost:58681`. Sign in there as 123@123.com and walk: planner This week
(arrows stop at the exam week, checklist present, rationale under the lanes),
Full plan (type 2020-01-01 into the date box: refused and put back), dashboard
double-tap a tick (nets out), an old week's "Carry into next week" (lands in the
current week).
