# Focus Track — the personalized revision lane

The programme view ("Your programme to the exams") has two lanes:

1. **The curriculum spine** — every topic of the course laid chronologically
   from the programme start to the exams, sized by how many spec points it has.
   This is the *teaching* plan: stable, prerequisite-ordered, and the only part
   that is persisted and diffed ("your plan has shifted — accept?").
2. **The Focus Track** — a personal, spaced-repetition lane computed live from
   the student's FSRS cards on every load. It injects short focus weeks on top
   of the spine and is never persisted, so it always reflects how the student
   is actually doing *today*.

Code: `src/lib/planner/pacing.ts` (`scheduleFocusPoints`, `revisitCount`,
`mergeFocus`), `src/lib/planner/scheduler.ts` (the FSRS engine and the mastery
model), `src/lib/programDal.ts` (composition), `src/components/planner/
RoadmapPanel.tsx` and `StudentPlanner.tsx` (UI).

> Keep this file honest. It has drifted from the code twice; a wrong model here
> is worse than no model, because it is what gets read before the code does.

## Cadence — why this is not a flashcard app

FSRS ships configured for someone drilling cards all day: its learning steps are
**1 and 10 minutes**. Left alone, a student who rates a topic "confident" gets it
back the same afternoon, and by their next visit every point they just sorted
reads as overdue. Two things keep the engine on the product's cadence
(`scheduler.ts`):

- **`enable_short_term: false`** — no sub-day steps at all; a card goes straight
  into review with an interval measured in days.
- **A 7-day floor on every due date** (`MIN_INTERVAL_DAYS`, applied in
  `applyReview`) — nothing is due before the student's next weekly visit. It only
  ever pushes a due date later, so a mature card's long interval is untouched,
  and stability/difficulty are never altered: FSRS still computes those from the
  real elapsed time at the next review.

Also set: `enable_fuzz: false` (deterministic — the same history always yields
the same due date, which previews and tests depend on) and
`maximum_interval: 365` (never schedule past the exam horizon).

## The mastery signal

Every spec point is an FSRS card per student. Cards advance on every graded
event — homework marks, MCQ attempts, and confidence self-ratings (the termly
board) — via the append-only review ledger (`student_spec_point_reviews`). One
drag of a topic writes one ledger row *per spec point beneath it*, so row counts
run an order of magnitude above the number of student actions.

`pointMastery` turns a card into a 0–100 score. **What the student said is the
anchor; the card's state adjusts it.**

| Card state                | Mastery                                     |
| ------------------------- | ------------------------------------------- |
| Never touched             | the student's confidence rating (or 0)      |
| Due / overdue             | `confidence − 5 − staleness − lapse charge` |
| Learning / relearning     | `confidence − 3 − lapse charge`             |
| Strong (long-term review) | `70 + min(30, stability/2)`                 |

- **staleness** = `5 × weeks overdue`, capped at 25 (`DUE_STALENESS_PER_WEEK`,
  `DUE_STALENESS_MAX`). Being due is a prompt to look again, not evidence of
  ignorance: a point that came due yesterday is barely marked down, one ignored
  for a couple of months slides a full band and comes back.
- **lapse charge** = `5 × lapses`, capped at 15 (`LAPSE_PENALTY`,
  `LAPSE_PENALTY_MAX`), and **absent from the strong branch** — see below.
- With **no self-rating at all** (a point only ever touched by homework or a
  quiz) the formula starts from a neutral 50, not 0 — the marks have already
  moved the card, and reading silence as ignorance would bury the point.

A topic's mastery is the mean across its points. Thresholds:

- **`< 34`** (`FOCUS_RED_BELOW`) — *needs work*: 3 revisits.
- **`34–66`** — *getting there*: exactly 1 revisit.
- **`≥ 67`** (`SETTLED_THRESHOLD`) — *settled/covered*: locked on the spine, one
  light review before the exams.

### The rule these thresholds must obey

**Every branch of `pointMastery` has to be able to reach `SETTLED_THRESHOLD`.**
This is the invariant that was broken for months and it is easy to break again.
The due branch used to be `25 + confidence/4`, whose ceiling is 50 — against a
bar of 67. A point that had come due therefore *could not* clear the bar at any
confidence, so a student could sort every topic into "Confident" and watch the
plan drag all of it back into the focus lane forever. If you change either the
formulas or the threshold, check them against each other.

### Lapses — what counts, and what it costs

A lapse means **knew it, then got it wrong**, and only a mark can establish that.
Two rules keep it honest:

- **A confidence self-rating never lapses a card.** Rating a topic "not
  confident" still sends FSRS a `Rating.Again`, so the point still comes back
  sooner — but `applyReview({ countsAsLapse: false })` holds the counter where it
  was. FSRS's scheduling reads stability, difficulty and retrievability and never
  the lapse count, so the schedule is bit-for-bit identical either way. Without
  this rule, a student who honestly reports a bad week is marked down for the
  honesty, permanently — and the counter ends up recording UI activity rather
  than learning.
- **The charge is capped, and the strong branch doesn't pay it.** A lapse has
  already collapsed the card's stability, and the strong branch is *made of*
  stability; charging again there prices one mistake twice. Leaving it out is
  also the route back: a point re-learned until it reads strong sheds the penalty
  entirely. Elsewhere it is capped at `LAPSE_PENALTY_MAX`, so an old bad patch
  cannot bury a point for good.

`priority()` also adds `5·lapses`, and that use is fine: it is a sort key for the
weekly plan (a repeatedly forgotten point *should* jump the queue), not a
threshold, and nothing about it is permanent.

## Band kinds

`PacingBand.kind` (bands stored before this field existed are `teach`):

- **`teach`** — the spine's first full pass through a topic.
- **`revisit`** — a 1-week focus band for a weak topic, carrying the specific
  spec points that earned it. May overlap other topics' teach bands by design: a
  revisit week is homework/quiz focus alongside whatever is being taught, exactly
  how the weekly plan interleaves due points.
- **`review`** — a 1-week light pass for a covered topic, placed at the start of
  the pre-exam revision window (default 3 reserved weeks).

## Scheduling — a capacity-limited queue

`scheduleFocusPoints` is a **revision queue with a weekly budget**, not a set of
fixed offsets. The problem it solves: FSRS resurfaces everything the moment it is
rated, so a student who rates nine topics badly would otherwise get nine topics'
worth of revisits dumped into next week.

- Each week has a budget of **`DEFAULT_FOCUS_BUDGET` = 6** focus spec points.
- Every weak point (mastery `< SETTLED_THRESHOLD`, in a topic that isn't settled)
  wants `revisitCount` looks: **3** if it is below 34, otherwise **1**.
- Week by week, the **weakest available points** take the slots; whatever doesn't
  fit cascades to the next week and is first in line there.
- A placed point's next look is scheduled a **widening gap** later (scaled to the
  runway), so it competes again later rather than every week.
- Points that never fit before the revision window simply are not scheduled — an
  over-rated backlog genuinely cannot all fit, and pretending otherwise is the
  bug, not the honesty.
- **Light reviews** for settled topics all land on the first week of the revision
  window and are budget-exempt.

## The loop ("keep focusing until they're happy")

Because the track is recomputed from live mastery on every load:

- A topic dragged to *Needs work* (or flopped in homework/MCQ) drops below 34
  → revisit bands appear immediately.
- Each revisit week surfaces that topic's due points in the weekly plan (the
  planner's `selectForWeek` already picks due/never-practised points,
  weakest-first), whose homework/quiz results advance the cards.
- When mastery clears 67 the topic flips to *Covered*: revisits vanish, the
  topic locks on the spine, and it queues one light review before the exams.
- A later flop lapses the cards, mastery falls, and the revisits reappear on
  their own — no special-casing.

## Invariants

- The Focus Track is **never persisted**. `student_program_plan.pacing` stores
  spine bands only (`acknowledge` filters on `isTeachBand`), and `diffPacing`
  ignores focus bands — the track's churn must never trigger an "accept the
  new plan" prompt.
- The spine's ordering never changes with confidence; only week *allocation*
  and the focus lane respond to it. Prerequisite order is preserved.
- Focus bands are always 1 week (`weeks: 1`).
- Every mastery branch must be able to reach `SETTLED_THRESHOLD` (see above).
- **One number per topic across the whole UI.** The confidence board's ring and
  the plan's percentage are both `masteryPct` — the board takes it from the
  roadmap the same screen already loaded (`masteryByTopic`) rather than deriving
  its own. The student's *rating* is expressed by which column the card sits in,
  never as a second number competing with the first. The board used to print the
  band midpoint (83 for "Confident") beside a plan reading 41%, with nothing
  saying they answered different questions.
- A reschedule of the spine is **proposed, never applied**: the student compares
  it against their accepted plan in the Full plan's temporary *Proposed* column
  and accepts it before anything moves.
