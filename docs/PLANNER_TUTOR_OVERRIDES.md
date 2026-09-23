# Tutor overrides on the weekly planner

Branch `claude/planner-tutor-overrides` · 2026-09-22

What a tutor can now do to a student's plan, how their decisions and the
scheduler's decisions combine, and how to check it.

## The gap

A tutor could add work to a week (a plan-point row with origin `tutor`, which
every re-cut keeps) but could not lastingly take work out. Deleting an
automatic row left no record, so the next cut — the student opening the week,
a catch-up top-up, a topic reorder — put the point straight back. Two related
gaps: a week a tutor created ahead of time was never completed by the
programme (a saved row stopped the cut), and a tutor could not reorder a
student's topics at all (`reorder_student_topics` bound to `auth.uid()`).

## The hierarchy

One rule, in `src/lib/planner/overrides.ts` (pure) and `enforce_plan_overrides`
(trigger), highest precedence first:

| Layer | Record | Effect |
|---|---|---|
| Pinned | plan-point row, origin `student` / `tutor` | Always in the week. Exempt from overrides and re-cuts. |
| Removed | `student_plan_overrides` kind `remove`, (point, week) | No automatic lane may fill that week with it. A review due then waits for the next open week; catch-up sits out that week. |
| Skipped | `student_plan_overrides` kind `skip`, (point) | No automatic lane may fill any week with it. Not owed by the backlog. Not reviewed. |
| Automatic | spine / catch-up / review lanes | Whatever the programme selects. |

Student work is a separate axis that outranks all four: a point with a
submission, an attempt or a tick in the week is never deleted by a removal or a
skip. Overrides shape what is *assigned*, not what was *done*. Past weeks are
history and cannot be changed.

## Where it is applied

| Layer | File | Role |
|---|---|---|
| Rule | `src/lib/planner/overrides.ts` | `indexOverrides`, `programmeMayAssign`, `applyOverrides`, `blockedBy` |
| Roadmap | `roadmap.ts` | Skipped points leave the review candidates and the backlog; `projectReviews` and `projectCatchUp` take `isBlocked` and step past removed weeks |
| Week cut | `weekCut.ts` `selectWeek` | Final filter on the selection; the rationale names how many were set aside |
| Top-up | `programDal.ts` `ensureCatchUp` | Re-tests before adding catch-up |
| Reorder | `programDal.ts` `reorder` | Tutor passes `_student_id`; reviews are re-projected around overrides |
| First cut | `useWeekPlan.ts` | A current week whose `source` is not `ai` is completed by `refreshWeek` around the pins |
| Reads | `planOverridesDal.ts` | `list` answers `[]` only when the table is absent; any other failure throws |
| Writes | `planOverridesDal.ts` | `remove`, `skip`, `move` (remove + pin), `pin` (withdraws a same-week removal first), `clear` |
| Database | `save_weekly_plan` | Filters overridden automatic points out of every re-cut |
| Database | `enforce_plan_overrides` | Drops an automatic insert/update of an overridden point, whatever client wrote it; pins pass |
| Database | `remove_plan_point`, `skip_plan_point` | Tutor/admin only; refuse past weeks, wrong subject; report when the student's work kept a point |
| Database | `reorder_student_topics` | New trailing `_student_id`; a tutor or admin may name a student |
| UI | `TutorPlannerPanel.tsx` | Master-detail: one week control, the roster down the side, the open student in the middle; student, subject, week and tab live in the URL (`lib/planner/plannerSearch.ts`) |
| UI | `TutorRoster.tsx` | Every student with "6 set · 2 done · 1 by you" per subject from one read (`PlannerRosterDAL.weekSummaries`); search; filters for "Not opened" and "Set by you" |
| UI | `TutorStudentPane.tsx` | Name, level, subject pills, then This week / Full plan / Practice history tabs; topic-order editor under Full plan |
| UI | `TutorWeekTab.tsx` | Rows filed by lane — Course this week, Catching up, Revision, Set by you, Added by the student — with a stats strip, the set-aside lists, the add box with warnings, and the week review |
| UI | `TutorRowMenu.tsx` | One "⋯" menu per row, in words: move to next week, move to another week, remove from this week, skip in the programme |

The screen shows the programme's projection for any week it has not cut yet
(`showsProjection` in `tutorWeekRows.ts`), so next week can be changed before
the student meets it. A projected row can be removed with nothing to delete;
the only sign a week is uncut is one banner, not a chip per row.

## Edge cases handled

- **Scheduler overwriting a tutor's removal.** Impossible at three layers: the
  cut applies overrides, `save_weekly_plan` filters them, the trigger drops them.
- **Tutor assigning a covered point.** The add box warns per point — assessed at
  70%+, ticked off, skipped, already in the week — and the button reads "Add
  anyway". Nothing refuses it; revision can be the intent.
- **Tutor removing a point the student has worked on.** The RPC refuses, keeps
  the row, writes no override, and the tutor is told the work kept it.
- **Pin after skip.** The pin stands for that week; the skip keeps binding the
  programme elsewhere. Pin after a same-week removal withdraws the removal.
- **Tutor-created future week.** When it becomes current the student's load
  runs `refreshWeek`, which merges the teaching, catch-up and reviews around the
  pins. The same fix covers a week a student carried points into.
- **Restore on a current, already-cut week.** The tutor's client re-cuts the
  week so the point can come back at once; a future week is cut when it arrives.
- **Older client.** A client without this code still cannot reinstate an
  overridden point: the trigger is the last word.
- **Migration not installed.** Reads answer "no overrides"; the tutor screen
  shows a notice and hides the controls; the scheduler behaves exactly as before.

## Database

`supabase/migrations/20260922104641_planner_tutor_overrides.sql`, idempotent.
Rollback: `supabase/rollbacks/20260922104641_planner_tutor_overrides.down.sql`.
`assessment_scheduler_version()` returns **5**; the client shows the override
controls at 5 or later.

**Applied to the linked project (`peohauhwquuvghrpmotf`) on 2026-09-22** via the
Supabase MCP, which recorded it as version `20260922104641`; the local file is
named to match. Verified live afterwards: version 5, the table and its three
policies, both triggers on `student_weekly_plan_points`, the ten-argument
`reorder_student_topics`, execute granted to `authenticated` and not `anon`, and
every function body md5-equal to the file (comments stripped — the MCP copy
omitted them).

`src/integrations/supabase/types.ts` was written by hand for the new table,
enum and functions; regenerate it if the generated shape drifts.

## Verification

```bash
bun test src/lib src/components                       # 300+ pass
bun x tsc --noEmit -p tsconfig.json                   # clean
bun x eslint src/components/planner src/lib/planner   # clean
PGLITE_MODULE=<path>/@electric-sql/pglite/dist/index.js bun scripts/test-plan-overrides-db.ts
```

The SQL script builds the schema in-process, applies the migration, and proves:
tutor-only writes; remove with worked / ticked / past-week / wrong-subject
guards; the trigger dropping automatic writes and keeping pins; the
`save_weekly_plan` filter; skip across current and future weeks with pins
reported and history untouched; clearing an override; a tutor reordering on a
student's behalf and another student being refused.

Not done: the tutor screen has not been exercised against production data in a
browser (a tutor sign-in is needed).
