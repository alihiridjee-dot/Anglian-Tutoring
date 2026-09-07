# Assessment-driven scheduler

## Behaviour

Teaching retains the specification order and weighted weekly allocation. FSRS
reconstructs memory from graded evidence, excluding historical confidence events.
No confidence ratings are read by the active review queue. Historical confidence
rows and old stored cards are retained, allowing rollback without data deletion.

Each skill has one next review. The raw FSRS due date remains untouched; eligibility
is max(raw due, last review + 168 hours). The first Monday opening at or after that
instant can receive the review. All eligible reviews are assigned without a weekly
count or weight cap. Teaching uses every week before the exam, with no reserved
pre-exam block. Curriculum weights still balance teaching across those weeks.

The queue never manufactures repeat counts or moves all secure skills into a final
review week. Dates beyond the exam remain outside the exam preparation assignment
horizon. Reviews without a weekly opening before the exam and teaching topics without enough runway are
reported rather than silently scheduled after the deadline.

Saved assignments remain stable. The current roadmap review column reads the saved
week; future reviews are estimates. The comparison panel previews assessment-driven
replacement and keeps started, completed, carried and manually assigned points.
Applying a replacement is disabled until database version 2 is available. Old weeks
are not automatically rewritten. Activity completion is scoped to the assigned week,
so last month's quiz does not complete a new review.

## Database rollout

Apply these migrations in order through the normal Supabase deployment process:

1. `20260906120000_assessment_memory_snapshots.sql`: stores immutable per-skill MCQ
   percentages inside the existing server grader. Existing answer-key access rules
   and attempt read policies remain in place. Historical snapshots are NULL and are
   deliberately not reconstructed against potentially edited answer keys.
2. `20260906121000_preserve_weekly_completion.sql`: retains existing `done_at` values
   when replacing a weekly assignment and exposes the version check for application.

3. `20260907120000_planner_read_models.sql`: adds RLS-preserving course and
   assessment-scope RPCs and revokes client writes to retired memory tables/RPCs.

These migrations have not been applied to the hosted database by this task.
Until the read RPCs exist, the application falls back to direct graded-source reads.
Only missing-function errors permit fallback. Historical confidence, stored cards
and client-written review ledger rows are never used as evidence. Grading invalidates
React Query caches; it does not write derived memory. Old single-skill quiz totals
remain eligible evidence when attribution is unambiguous.

Calendar keys and weekly eligibility use Europe/London regardless of the viewer's
location. The pure FSRS fold remains client-side; read consolidation does not itself
create a background scheduling service. See `architecture.md` for module boundaries.

Before rollout, back up the database using the existing operational process and
compare representative saved weeks with the read-only comparison control. Rollback
requires a compatible application version that does not call the retired write RPC;
the new nullable snapshots can remain archived.
Do not drop confidence history or snapshot columns as a rollback operation.

## Practical limits and follow-up validation

- Homework is currently evidence for its explicitly linked assessment scope using
  the overall tutor mark; per-question homework skill scoring is not implemented.
- Untagged or legacy mixed quizzes cannot seed precise individual memory records.
- Past assignments are preserved rather than migrated automatically. The full-year
  teaching outline remains an outline, not a record that each lesson was delivered.
- Shared activities can cover multiple points; workload estimates are not yet
  deduplicated at activity level. Eligible review workload is uncapped.
- Exam-date risk prediction and a full cohort workload forecasting tool are not yet
  implemented. Current backlog reporting covers the next-review queue only.
- Memory reconstruction reads source history rather than persisting a new versioned
  cache; profile this with large real histories before a broad production rollout.
- Existing explicit carry/add-practice controls remain human overrides to spacing.

Validation covers deterministic FSRS updates, confidence exclusion, assessment
snapshot attribution, weekly completion boundaries, seven-day eligibility, Monday
rounding, uncapped review selection, full-window teaching, exam horizon and stable projections.

## Synthetic full-year scenarios

Run `bun scripts/simulate-scheduler.ts`; results are in `scheduler-simulation.json`.
The scenarios use 90 unit-weight skills, uncapped eligible reviews and the full
teaching window. Results report peak weekly reviews and spacing violations. These
are synthetic stress scenarios, not predictions for actual students.
