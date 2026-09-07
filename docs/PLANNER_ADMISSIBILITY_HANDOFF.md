# Plan-point admissibility

Branch `claude/core-curriculum-architecture-cf8c56` · Supabase `peohauhwquuvghrpmotf` · 2026-09-07

Built by Claude, reviewed and substantially corrected by Codex, finished by Claude.
This records what shipped and how to check it.

## The defect

Reviews were assigned for topics the teaching spine had not reached — Topics 3
and 6 were the reported symptom. Two independent causes:

1. **Admission had no spine test.** `focusInputs` admits any point with
   `reps > 0`. `reps` comes from an FSRS card, a card comes from evidence, and
   evidence can exist ahead of teaching: `assessmentPointScores` scores every
   point in an MCQ set's `point_scores`, so a quiz tagged across topics seeds
   cards for untaught points. Nothing asked whether the spine had opened.
2. **Eviction had no override.** `save_weekly_plan` deleted only rows with no
   `done_at`, no `carried_from` and an automatic origin. A stale review the
   student ticked off was immune to every automatic path and needed a manual
   delete.

## The rule

`src/lib/planner/admissibility.ts` — pure, no I/O, one definition.

- `spineReach(bands)` → Map<topicId, earliest teach-band startWeek>; revisit bands ignored.
- `admit(point, ctx)` → `{ok}` | `{ok:false, reason}`.
- Reasons: `ahead-of-spine | no-evidence | beyond-exam | off-course | orphaned`.
- Helpers: `partition`, `hasStudentHistory`, `isHandPicked`, `describeReason`.

Order: orphaned → off-course (`onCourse === false` only) → beyond-exam →
hand-picked origins exempt → ahead-of-spine → no-evidence (focus lane only).

Two decisions:
- **Topic-level, not point-level.** Band starts are stable; the point-to-week
  split is recomputed each load and would refuse work mid-topic.
- **A topic missing from `reach` is unproven, not refused.** Stored pacing can
  predate a curriculum change. Matches the trigger, which allows that case.

## Where it is applied

| Layer | File | Role |
|---|---|---|
| Generation | `programDal.ts` | Reviews are **deferred**, not dropped — `projectReviews` takes `topicOpenings` and clamps a review's week to its topic's opening |
| Read-back | `weeklyPlanDal.ts` `classify()` | `getPlan` returns `points` (active) and `withheld` — stored mistakes stop rendering with no data migration |
| Write | `weeklyPlanDal.ts` `screen()` | Both write paths funnel through; hand-picked rejections throw, automatic ones are withheld with a warning |
| Database | `plan_point_admissible` | Cannot be bypassed by anything reaching PostgREST |
| Database | `plan_matches_enrolment` | The plan itself must be for a course the student sits |
| UI | `WithheldPlanPoints.tsx` | Surfaces what was withheld, wired through the planner panels |
| Audit | `scripts/audit-plan-integrity.ts` | Read-only sweep of every saved week |

The app reads the **acknowledged** pacing (`baseline.pacing`), not a live
recomputation, so it gives the same answer as the trigger.

## Database

Local files:
- `supabase/migrations/20260907130000_plan_point_admissibility.sql`
- `supabase/migrations/20260907140000_preserve_inadmissible_history.sql`

Both applied. Remote history splits them across five entries (names differ from
the filenames because the first was applied in stages — function before trigger,
so a parse failure could never leave a broken trigger live):

```
20260907201338 plan_point_admissibility_function
20260907201352 plan_point_admissibility_trigger
20260907201444 assessment_scheduler_version_3
20260907202734 plan_matches_enrolment
20260907xxxxxx preserve_inadmissible_history
```

Both files are idempotent, so `db push` re-applying them is safe.

`enforce_plan_point_admissible` (on `student_weekly_plan_points`): point must
have a topic; topic's course must equal the plan's; plan must still match the
student's enrolment and level; week must be before the programme exam date; and
for automatic origins the topic's teach band must open on or before the plan's
week. SECURITY DEFINER so an unreadable pacing row cannot read as "nothing to
enforce".

`enforce_plan_matches_enrolment` (on `student_weekly_plans`): plan board must
appear in `student_enrolments`; plan level must match `profiles.level`. The
level check runs even when the subject has no enrolment row.

`save_weekly_plan` additionally protects any point with a homework submission or
MCQ attempt inside the plan's **Europe/London** week — graded or not. Ungraded
work is still student work.

`assessment_scheduler_version()` returns **4**.

## Data changes made

- 23 plan points deleted — Biology, automatic origins, no completion or carry,
  ahead-of-spine (Topic 6 assigned six months before its band opens).
- 1 plan + 3 points deleted — chemistry week 2026-08-03, `board = aqa` for a
  student enrolled on Edexcel, generator-authored.

**20 `no-evidence` findings remain and were deliberately left.** They are focus
points in past weeks with no assessed practice behind them (verified in SQL:
no attempts via set, `point_scores` or question tag; no graded homework via
either link). They are not deleted because evidence can in principle be removed
after the fact — a deleted quiz — and quarantine already handles them: they are
withheld from the active week and shown as withheld. `bun run
scripts/audit-plan-integrity.ts` therefore exits 1 by design until they are
reviewed by a person.

## Root cause of the wrong-board plan

`save_student_enrolments` does
`on conflict (student_id, subject) do update set board = excluded.board`. The
board changes in place — `created_at` unmoved, no `updated_at`, no history. The
enrolment said AQA on 6 Aug and was changed to Edexcel later; past weeks are
never re-cut, so that week survived. **Why it said AQA is not recoverable from
the data.** Not fixed: a board change still leaves earlier weeks stamped with the
old board. Suggested follow-up: add `updated_at` to `student_enrolments`.

## Verification

```bash
bun test src/lib                      # 147 pass
bun x tsc --noEmit -p tsconfig.json   # clean
bun run lint                          # clean
```

SQL regressions run against in-process Postgres — no Docker, no production:

```bash
bun add -d @electric-sql/pglite   # or point PGLITE_MODULE at an existing install
PGLITE_MODULE=<path>/@electric-sql/pglite/dist/index.js bun scripts/test-plan-admissibility.ts
bun scripts/test-plan-integrity-audit.ts
```

Live schema:

```sql
select public.assessment_scheduler_version();          -- 4
select tgname from pg_trigger where not tgisinternal
 and tgrelid in ('public.student_weekly_plan_points'::regclass,
                 'public.student_weekly_plans'::regclass);
```

Trigger behaviour was proven with `DO` blocks ending in `raise exception`, so all
test writes rolled back: ahead-of-spine rejected, wrong-course rejected, valid
hand-picked accepted, wrong-board plan rejected, correct-board plan accepted.

## Known gaps

- `RoadmapPanel.tsx` badges: "unchanged" is row-scoped and "Moved from X" is
  topic-scoped, and they render together and read as a contradiction. Separately,
  `diffPacing` flags a change when only a band's *duration* differs, so a topic
  whose start did not move still renders "Moved from <its own start week>".
- A pending spine reschedule is outstanding for Biology, caused by commit
  `0220499` changing `computePacing` from `weeksBetween(start, exam) - 3` to the
  full window. Baseline spans 46 weeks, live spans 49. Not a data problem.
- PGlite is not a project dependency; the SQL harness needs it supplied.
- The demo route uses fixtures, so it cannot exercise the withheld UI. That path
  has not been seen rendering with real data.
