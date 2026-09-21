# Individual topic ordering

Students open **Planner → Full plan → Change topic order**. Drag a whole topic
or use its up/down buttons, choose a Monday, inspect the weighted calendar, and
save. The editor never exposes point-level edits. Students who do not save a
custom order retain the existing automatic curriculum sequence.

## Scheduling contract

- Only weeks on or after the chosen current/future Monday are redistributed.
- Earlier weekly point allocations are frozen, including the earlier portion
  of a topic spanning the boundary. Its remaining points move as one topic.
- Remaining topics receive whole weeks proportional to their remaining point
  weights. Point order stays in curriculum order. Insufficient teaching weeks
  block saving rather than dropping topics or extending past the exam.
- Missed work keeps its original promised week; changing a future topic never
  invents earlier missed work. Existing catch-up is retained.
- Assessment and memory records are never changed. Current assigned reviews
  stay assigned. Unprotected future review assignments are regenerated from
  assessed eligibility and the revised review openings. Moving teaching later
  cannot delay a previously established review opening.
- Existing completed, carried, manually assigned and attempted work is retained,
  including attempts made before the saved assignment's week. Preserved work
  can sit alongside the newly scheduled teaching.
- Exam-date changes keep the student's chosen topic sequence, freeze elapsed
  weeks, and use the existing preview/accept flow. Dates with too little runway
  are rejected. Previously split topics do not create false change prompts.
- A stale plan or changed curriculum rejects saving. Each course point must
  appear exactly once in the persisted calendar and stay within its own topic.

## Persistence and compatibility

Custom bands use the existing `student_program_plan.pacing` JSON column.
`fixedPoints` marks a persisted `pointsByWeek` allocation, and `schedule` records
its effective Monday and exam horizon. `openedWeek` preserves admission for
already-reached teaching; `reviewStartWeek` preserves the previous review horizon.
All normal readers use these fields; no other student's plan is updated.

`reorder_student_topics` binds to `auth.uid()` and runs with existing RLS. It
locks and compares the expected baseline and exam date, validates the allocation,
then updates the spine and affected saved weekly plans in one transaction using
`save_weekly_plan`. Failure rolls back the whole operation.

Install **only** migration `20260915120000_student_topic_order.sql`, then release
this frontend before enabling real custom plans. Older frontends do not understand
fixed custom allocations. Do not push all local migrations to the linked database:
its earlier migrations are recorded under different timestamps.

Migration `20260915120000` was installed in the linked database on 15 September
2026 after explicit user approval. Only this migration was applied, atomically,
and its version was registered. Installation did not change student plans or
assessment records. The matching frontend still needs to be released to Vercel
before students use custom orders in production.

## Verification

- `bun test src/lib/planner src/lib/planner/programDal.test.ts`
- `bunx tsc --noEmit`
- `bun run build`
- Isolated PostgreSQL regression script, using a temporary PGlite installation
  outside the project (no application dependency change):
  `PGLITE_PATH=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-topic-order-db.ts`

The SQL script uses synthetic students and real migration functions. It verifies
historical weeks, protected work, current/future revision, future boundaries,
stale previews, student isolation, and complete rollback on a write failure.
Browser checks cover pointer drag, arrow controls, effective-week selection,
partial topics, desktop side-by-side layout, and phone overflow.
