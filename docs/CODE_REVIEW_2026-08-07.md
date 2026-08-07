# Code review — 7 August 2026

Speed, modularity, and whether anything has turned into spaghetti. Companion to
[SECURITY_AUDIT_2026-08-07.md](./SECURITY_AUDIT_2026-08-07.md).

**Verdict: this is a well-kept codebase.** Zero `console.log`, one `any` in
~44k lines, 125 passing tests, a consistent DAL layer, and comments that explain
*why* rather than restating the code — which is rarer than it should be and is
the reason this review could move quickly.

Four things were worth fixing, and they're done. Three more are flagged below.

---

## Fixed

### 1. The same three label maps, copied into 21 files — and the bug that caused

`subjectLabel`, `levelLabel` and `boardLabel` were redefined locally in twenty-one
files. `lib/courseSummary.ts` already exported all three, derived from
`lib/taxonomy.ts`, with the docstring *"answered once, for the whole app."*
Nothing used it.

Duplication like this doesn't stay harmless — it drifts, and it had:

| Where | What it said | What a student saw |
| --- | --- | --- |
| `mcqs.tsx` | `level === "alevel" ? "A-Level" : "GCSE"` | **An iGCSE quiz filed under a "GCSE" heading** — the wrong qualification, on the page where they choose what to revise |
| `WeeklyFocusCard`, `WeeklyFocusManager`, `student-dashboard` | `{ gcse, alevel }` only | `igcse` and `gcse_trilogy` rendered as raw lowercase enum values |

iGCSE became a level on 2026-07-29 and Combined Trilogy before it. Both were
added to `taxonomy.ts` — and to none of the twenty-one copies, because nothing
connected them.

**Fixed** — every local map deleted, all call sites moved onto the canonical
helpers, which fall back sensibly for values they don't know. One place to add
the next level.

### 2. Recharts shipped on the marketing pages — 108 kB gzip off every page load

`TrendsChart` is the only component in the app that imports Recharts, and it
renders on one route (`parent-dashboard`). Imported statically, Rollup hoisted
Recharts and its d3 + lodash tail into the chunk **every route shares** — so a
visitor reading the landing page downloaded a charting library before seeing a
word of it.

**Fixed** — `React.lazy` on `TrendsChart`, behind a `Suspense` placeholder sized
to the chart so nothing jumps.

```
shared entry chunk   299 kB gz  →  191 kB gz   (−36%)
recharts                         →  its own 107 kB chunk, parent dashboard only
```

Route splitting was already working well otherwise — 92 chunks, and the biggest
per-route chunk is 16 kB gzipped.

### 3. Marking a paper was one round trip per question, in a queue

`useAnswerMarking.saveMarks` looped over answers `await`ing each UPDATE in turn.
A twelve-question paper was twelve sequential round trips — over a second of a
tutor watching a spinner, for writes that don't depend on each other.

**Fixed** — `Promise.allSettled`, so they go together and one failure no longer
abandons the rest. See *Flagged #1* for the proper version.

### 4. Thread list was quadratic in an inbox

`ChatDAL.listThreads` re-filtered the entire message array once per thread —
O(threads × messages). Invisible for a student with three conversations; the
tutor working a full inbox is the only person who ever sees the big version.
**Fixed** — bucket by thread id once, O(messages).

### 5. `architecture.md` documented software that doesn't exist

It described `demoAuth.ts`, `client.server.ts` and `routes/demo.tsx` (all
deleted), the seeded `demo.student`/`demo.parent` accounts and the
`demo_visible` columns (removed in July — confirmed gone from the database), and
stated there was *"deliberately no code-redemption RPC"* when
`link_child_by_code` exists and is live.

Stale architecture docs are worse than none: they're what someone reaches for
before touching the auth model. **Rewritten**, including the access-control
section now reflecting today's grants.

---

## Flagged — worth doing, not done here

### 1. `mark_homework_answers` should be an atomic RPC

The parallel fix above removes the latency but not the real problem: marking a
paper is still N separate writes with no transaction, so a failure halfway
leaves a half-marked submission and no way to tell from the UI.

The codebase already solves this three times — `record_reviews_atomic`,
`save_weekly_plan`, `save_student_enrolments` — and this is the same shape. The
migration is straightforward (tutor-gated SECURITY DEFINER, `update … from
jsonb_array_elements`), but it needs `types.ts` regenerated, so it wants a
moment when you can watch it land rather than being applied overnight.

### 2. The thread list downloads every message in every thread

`listThreads` fetches the full body of every message across every visible thread,
purely to compute an unread count and a preview line. Two round trips regardless
of thread count, which is why it hasn't hurt yet — but a tutor with a year of
history is downloading all of it to render a sidebar. A `chat_thread_summaries()`
RPC returning `(thread_id, unread, last_message)` would make it constant.

### 3. Two large route files

`curriculum.tsx` (1,412 lines) and `StudentPlanner.tsx` (1,039) are the only
files over 1,000. Neither is a monolith — `curriculum.tsx` holds 13 named
components — so this is a "worth splitting when you next touch it" note, not a
problem. Everything else sits comfortably under 850.

---

## Verified healthy

- **Layering is consistent.** Data access lives in DALs (`curriculumDal`,
  `chatDal`, `plannerDal`, `weeklyPlanDal`, `scheduleDal`, `programDal`),
  React Query hooks wrap them, components consume the hooks. Almost nothing
  reaches past its layer.
- **Pure logic is pure and tested.** `planner/` (scheduler, pacing, coverage,
  reviewLock, foldReviews), `billing`, `curriculumCoverage`, `homeworkDrafts`
  and `ai/throttle` are dependency-free and carry the 125 tests. This is the
  right split — the FSRS maths can be reasoned about without a database.
- **Multi-row writes already go through atomic RPCs** where it counts, and the
  comments say why (`save_student_enrolments`: *"Moving in the same transaction
  as the rows above is the whole point of this function"*).
- **The N+1 hazards that remain are the acceptable ones.** File uploads are
  sequential deliberately (bandwidth-bound, and parallel uploads on a phone are
  worse); the onboarding grade loop runs over at most three subjects.
  `createResourceSignedUrls` already batches what used to be one authenticated
  round trip per image.
- **`chunked.ts`** exists to keep `.in()` filters under URL limits — someone had
  already thought about the cohort-sized case, and `ai/throttle.ts` says so
  explicitly.
- **No dead `console.log`, no `@ts-ignore`, one `any`.** Lint and typecheck both
  clean.

---

## Commands

```bash
bun x tsc --noEmit && bun x eslint . && bun test && bun run build
```
