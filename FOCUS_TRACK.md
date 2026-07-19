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

Code: `src/lib/planner/pacing.ts` (`injectFocusBands`, `revisitOffsets`,
`amberRevisitGap`), `src/lib/planner/scheduler.ts` (mastery model),
`src/lib/programDal.ts` (composition), `src/components/planner/RoadmapPanel.tsx`
(UI).

## The mastery signal

Every spec point is an FSRS card per student. Cards advance on every graded
event — homework marks, MCQ attempts, and confidence self-ratings (the termly
board) — via the append-only review ledger (`student_spec_point_reviews`).

`pointMastery` turns a card into a 0–100 score:

| Card state                   | Mastery                                        |
| ---------------------------- | ---------------------------------------------- |
| Never touched                | the student's confidence rating (or 0)         |
| Due / overdue                | `25 + confidence/4 − 5·lapses`                 |
| Learning / relearning        | `50 − 5·lapses`                                |
| Strong (long-term review)    | `70 + min(30, stability/2) − 5·lapses`         |

A topic's mastery is the mean across its points. Thresholds:

- **`< 34`** (`FOCUS_RED_BELOW`) — *needs work*: recurring revisits.
- **`34–66`** — *getting there*: exactly one revisit.
- **`≥ 67`** (`SETTLED_THRESHOLD`) — *settled/covered*: locked on the spine,
  one light review before the exams.

The due-state blend matters: FSRS early-stage intervals are minutes-to-days,
so at our weekly cadence a freshly rated card is "due" almost immediately.
Blending stated confidence keeps a confident-but-due topic amber (one revisit)
while a needs-work or repeatedly-lapsing topic stays red (keeps recurring).

## Band kinds

`PacingBand.kind` (bands stored before this field existed are `teach`):

- **`teach`** — the spine's first full pass through a topic.
- **`revisit`** — a 1-week focus band for a weak topic. May overlap other
  topics' teach bands by design: a revisit week is homework/quiz focus
  alongside whatever is being taught, exactly how the weekly plan interleaves
  due points.
- **`review`** — a 1-week light pass for a covered topic, placed at the start
  of the pre-exam revision window (default 3 reserved weeks).

## Scheduling — scaled to the runway

All spacing derives from the **runway**: the whole weeks between the current
Monday and the start of the revision window. The same spaced-repetition shape
applies at every horizon — often at first, stretching out as it sticks:

- **Needs-work revisits** land at ~2.5%, 7.5%, 17.5% and 37.5% of the runway
  (each at least a week after the last, none inside the topic's own teach band
  or the revision window). A ~44-week school year gives offsets ≈ [1, 3, 8, 17]
  weeks from now; a 12-week sprint compresses to [1, 2, 3, 5]; with two weeks
  left there is a single revisit next week.
- **Getting-there revisits** land ~10% of the runway after the topic's teach
  pass ends (clamped to 2–6 weeks), or soon (+2 weeks) if that pass is already
  behind the student.
- **Light reviews** all land on the first week of the revision window.

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
