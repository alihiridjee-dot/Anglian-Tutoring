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

4. `20260907130000_plan_point_admissibility.sql`: enforces, in the database, that
   a weekly plan holds only work the programme has reached. Two rules — the spec
   point must be on the plan's own course (every origin), and for automatic
   origins its topic's teach band must have opened by the plan's week. Hand-picked
   origins (`student`, `tutor`) are exempt from the second, so explicit tutor and
   student overrides to spacing still work. The test reads the acknowledged
   `student_program_plan.pacing`, not a live recomputation: until a student
   accepts a moved exam date, the stored spine is the one they are living by.
   Bumps `assessment_scheduler_version()` to 3. Applied in three steps — function
   and index, then the trigger, then the version — so that a parse failure could
   never leave a broken trigger live on the table. Verified with a rolled-back
   transaction covering all three outcomes: an ahead-of-spine automatic point
   rejected, another course's point rejected even for a tutor, and a valid
   hand-picked point accepted.

   The same migration adds `plan_matches_enrolment` on `student_weekly_plans`:
   a plan's board must appear in the student's `student_enrolments` for that
   subject, and its level must match their profile. The point-level rule cannot
   see this case — it compares a topic to the *plan's* board, so a wholly wrong
   plan holding wholly matching points agrees with itself and passes. An Edexcel
   GCSE chemistry student had one AQA week, generator rationale and all, sitting
   between three correct Edexcel weeks; it was removed on 2026-09-07 along with
   its three points. Both rules fail open where there is nothing to compare
   against — no enrolment row, no profile level — because the rule refuses a
   contradiction, never an absence. The root cause of the wrong-board generation
   is not yet identified; a tutor's board filter reaching `planForWeek` is the
   leading candidate and is worth confirming.

All four are applied to the hosted database as of 2026-09-07, verified against
`pg_proc`/`information_schema` rather than the migration history table, which is
not a reliable record in this project. `assessment_scheduler_version()` returns 3.
The application still falls back to direct graded-source reads when a read RPC is
missing, so it remains safe against an older database; only missing-function
errors permit that fallback. Historical confidence, stored cards
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
- Assignment admissibility is one rule in `src/lib/planner/admissibility.ts`, applied
  at generation, at read-back of saved weeks, at the DAL write chokepoint and in the
  database trigger. An inadmissible point with completion, carry or attempt history
  is quarantined — kept but withheld from the week — rather than deleted; one
  without is dropped on the next re-cut. `bun run scripts/audit-plan-integrity.ts`
  sweeps every saved week for violations and exits non-zero when it finds any.

Validation covers deterministic FSRS updates, confidence exclusion, assessment
snapshot attribution, weekly completion boundaries, seven-day eligibility, Monday
rounding, uncapped review selection, full-window teaching, exam horizon and stable projections.

## Synthetic full-year scenarios

Run `bun scripts/simulate-scheduler.ts`; results are in `scheduler-simulation.json`.
The scenarios use 90 unit-weight skills, uncapped eligible reviews and the full
teaching window. Results report peak weekly reviews and spacing violations. These
are synthetic stress scenarios, not predictions for actual students.
