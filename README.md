# Anglia Educate

A production tutoring platform for GCSE and KS3 science (Biology, Chemistry, Physics) across Edexcel, AQA, and OCR. Built with React, TanStack Start, Tailwind v4, and Supabase.

## Design system — "exam-board pop"

Light mode only. Every colour is an OKLCH custom property in `src/styles.css`,
which is **the** source of truth — this file names the tokens and never repeats
their values, because the last copy of the palette in here went stale the day
the system was redesigned.

### Build from the kit, not from Tailwind

The stylesheet ships the chassis every surface is made of. Reach for these
before writing a border, a shadow or an uppercase label by hand:

| Class                         | What it is                                                       |
| ----------------------------- | ---------------------------------------------------------------- |
| `.premium-card`               | The card — printed outline and a two-layer offset shadow         |
| `.chip` / `.chip-solid`       | Status and metadata pills                                        |
| `.sticker` / `.sticker-alt`   | A chip slapped on at an angle. One per page — four is none       |
| `.eyebrow`                    | The micro-label above a heading (`.eyebrow-bare` drops its rule) |
| `.icon-tile`                  | The rounded square an icon sits in                               |
| `.btn-premium` / `.btn-solid` | The pressable chassis. Buttons travel down into their shadow     |
| `.numeral`                    | Display-type tabular figures, for counts and stats               |
| `.page-aurora`                | The page-level wash                                              |

`src/components/Shared.tsx` holds the composed pieces — `PageHeader`,
`SectionHeading`, `Chip`, `EmptyState`, `Spinner`, `Meter`, `Ring`, `StatTile`,
`Milestone`. Use them rather than rolling a heading, a pill, a progress bar or
a loading state per screen; every one of those had drifted apart before they
existed. A pill with an icon is `<Chip icon={…} tint="tint-…">`, which keeps
the icon one size everywhere. `src/components/Doodles.tsx` holds the mascot cast, and it belongs in
empty states, milestones and the 404 — not inside a working tool.

### A page of work is a trail, not a stack of accordions

The spec point page (`SpecPointDetail.tsx`, the `point-*` block at the end of
`src/styles.css`) is the pattern for any page that offers a learner several
kinds of work on one thing. It is the house style, "playful minimalism": few
surfaces, large type, and the fun carried by motion and emoji, not by more boxes.

- **Stops, not sections.** Each kind of work is a round stop on a dotted line
  (Watch → Read → Quiz → Task). Pressing a stop opens its work in **one** card
  underneath. Never a column of collapsible cards, and never a section that
  says "0 items": a stop with nothing behind it is not drawn. A stop whose work
  is on its way is a dashed outline with the loading dots.
- **The title sits on the page**, not in a card: one plain line above it (course
  and code), the title large, a drawn highlighter stroke under it. No pill, no
  eyebrow, no ALL CAPS label, no gradient bar.
- **When it was due sits in a straight panel.** On a wide screen the page is
  two columns: the title, trail and card on the left, and the "When" panel
  (`WhenPanel`) on the right, staying in view. It has the same three rows on
  every point (Due week, Status, Catch-up) and a button into that week of the
  plan. Nothing is tilted. On a narrower screen the panel sits under the work.
  The topic list says the same thing on each row (`WhenWord`: "Due 2 Nov",
  "Catch-up 16 Nov").
- **Rows are bare.** Inside the card a row is a bold title and one `.btn-solid`.
  No border or background per row, and no small grey text: a line that matters
  is normal dark text, and one that doesn't is deleted.
- **Motion says something.** The picked stop grows and takes a highlighter
  ring, the card rises in, a pencil scribbles while work is written. Each has a
  `prefers-reduced-motion` rule.
- **Phones get the same trail**, smaller (`--dot` shrinks under 600px), with
  every stop still a 44px target. Do not swap it for a different phone layout.

### A tutor's tool is a workbench

The trail above is for a learner. A tutor's working screen is the other way
round: function first, plain and dense. The planner's workbench
(`src/components/planner/workbench/`, one student across the whole page) is the
pattern, and Ali's rules for it are:

- **The work surface fills the page**, and what waits on the tutor sits beside
  it. On a phone it is one part at a time, never a squeezed copy of the laptop.
- **One way to change things.** Tick lines, then act on them in the bar that
  appears. No menu per row.
- **An action happens where it is read.** A reply box opens under the message;
  nothing jumps to another page to be answered.
- **No loose numbers, and no pills.** A count sits inside a round dot beside its
  word (`Tally`), a mark is a ring filled as far as the mark with the figure
  inside (`Mark`), and a status is a coloured dot and a word (`StatusWord`), all
  in `workbench/figures.tsx`.
- **Kinds are told apart by a stripe, an icon and a name in one colour**: the
  lanes of a week (Course, Catch-up, Revision), and the kinds of thing beside
  the plan (check-in, message, a problem with the plan).
- **A panel is named for what is in it.** "To answer" holds what a student or
  parent has sent, "About the plan" what is wrong with the plan. One panel
  called "Needs you" over both read as a question, not a heading.
- **Only what waits on the tutor gets a panel.** Missed work had one until
  21 Nov 2026 and lost it: it comes back as catch-up on its own. The grid's
  "Missed" filter finds those lines, and "About the plan" says when they won't
  fit before the exams.
- **The roster is the page.** With nobody open, every student is a row and
  every subject a column (`workbench/RosterGrid.tsx`); a cell opens that
  student on that subject.

No session can sign in as a tutor, so the workbench is looked at on the
dev-only `/planner-preview`, which draws the same panels over made-up data.

### Everything colours itself from `--tint`

The kit mixes against a single inherited `--tint`, so a card, its meter, its
chips, its icon tile and its shadow are one colour without any of them naming
it. Set the tint on an ancestor and the subtree repaints:

- `SUBJECT_TINT[subject]` from `src/lib/curriculum/subjectTheme.ts` for the three sciences
  (`--bio` green, `--chem` violet, `--phys` blue)
- `tint-primary`, `tint-accent`, `tint-pop`, `tint-rose`, `tint-amber`,
  `tint-emerald`, `tint-slate` for everything else

Two consequences worth knowing. A raw Tailwind palette class (`bg-emerald-500`,
`text-sky-700`) opts that element out of the whole system and will stay the
wrong colour inside a tinted card — that is a bug, not a shortcut. And any
element that changes `--tint` must let `--lift-1/2/3` re-resolve, which the
`tint-*` classes already do; a nested `var()` in a custom property is
substituted where it is _declared_, so a tint set any other way casts a
brand-blue shadow off a green card.

### Type

- Display: **Bricolage Grotesque** — headings, stat numerals, stickers, eyebrows
- Body: **Plus Jakarta Sans**

Loaded via Google Fonts in `src/routes/__root.tsx`.

Every `h1`–`h6` is display type by the element (an `@layer base` rule), so a
heading needs no class to be in the right face. `.font-display` is only for
things that are display type _without_ being headings. Display type is **bold
(700) or heavier** — semibold is out; it reads as a different typeface at these
weights. `font-sans` remains the escape hatch, and utilities still beat the base
rule, so `tracking-widest` on a small uppercase label wins as intended.

### Science notation

Formulas, ions, units and powers are stored as plain text with Unicode small
figures (H₂O, Mg²⁺, cm³, 10⁻³), and `toSciNotation` in
`src/lib/platform/sciNotation.ts` turns typed notation ("H2O", "Mg2+",
"SO4^2-", "cm3", "CnH2n+2") into that form. It only changes what it is sure
of, so labels and codes (AO1, KS4, H1N1, B2, F1/F2, P1V1, OCR C6.2b) are left
alone, and "I2" is iodine only beside chemistry (in "I2 = P / R" it is a
current squared). Its test file lists the cases; it has been run over every
stored question, mark scheme, exemplar and note without losing a character.

- Show any question, option, explanation, mark scheme, answer, feedback or
  note text through `SciText` (in `Shared.tsx`), never as a bare `{text}`. It
  formats old text too, draws the small figures in the site's face (the web
  fonts have no ₂ or ⁺), and stacks a nuclide's numbers (²³⁸₉₂U). Pass
  `context` when texts sit together (a question and its options, an answer
  and its question), so a wrong option is written like the right one.
- Take typed science through `SciAnswerBox` (`src/components/homework/`):
  answers, notes to the tutor, marking comments and feedback, task
  instructions, question and mark-scheme boxes. It shows how formulas will
  read, and its x₂ and x² buttons work as in a word processor: press, type,
  press again (or type a space); with text selected, a press converts it.
  Its Units button opens the units and symbols a keyboard lacks (μm, cm³, Ω,
  °C, × 10ⁿ, ⇌), each put in at the cursor; "20 um" and the micro sign µ are
  read as μm.
- Generated questions are normalised before saving, tutor-written ones on
  save, and every prompt whose reply a student reads states the notation
  (`NOTATION_RULE` in `src/lib/platform/aiText.ts`; the marker and generator
  carry their own). The revision-note guides say it too, and
  `scripts/notes/validate.ts` flags flat notation.

### Phones, either way up

- **Tap targets** are 44px on any touch screen: `min-h-11 sm:pointer-fine:min-h-0`
  (or `h-11`, `size-11`), never a bare `sm:` undo. A phone turned sideways is
  wider than `sm`, and so is a tablet.
- **`short:`** styles a phone on its side: 340–440px tall and as wide as a
  tablet, so every width breakpoint hands it a desktop layout it has no height
  for. Anything pinned, sized to the screen, or meant to fit on one screen needs
  a look at `short:`. The sidebar follows `rail:` and `drawer:`, and an open
  conversation goes full screen with `.thread-sideways`. See
  `docs/LANDSCAPE_UX_AUDIT_2026-10-03.md`.
- **`phone:`** is a phone held upright and nothing else: under 600px wide _and_
  a touch screen, so neither a narrowed desktop window nor a tablet qualifies.
  It is for a surface with a phone-only layout (the weekly task list's step
  trail): put `hidden phone:flex` on the phone's half and `phone:hidden` on the
  other, so the two are exact opposites and a screen always gets one of them.

## Tech

- React 19, TanStack Start v1, Tailwind CSS v4, TypeScript strict
- Supabase — Auth, Postgres with RLS, Storage
- Anthropic Claude — written question and MCQ generation
- Stripe — monthly subscriptions
- Microsoft Teams — live session scheduling

## Exam question generation

The framework lives in `src/lib/homework/examGeneration.ts`; its database and Claude calls
live in `src/lib/homework/examGeneration.server.ts`. The practice queue, the tutor's MCQ
generate and Replace questions buttons, and the tutor's written-task drafts all use it.
There is one model call per generated set for a specification point. Existing
publishing paths and the reuse of already-generated homework are retained.

Each spec point's shared quiz and task are library content, and only the practice queue
(`src/lib/practice/practiceQueue.server.ts`) writes them. Saving a student's week
queues its points' missing quiz and task (a database trigger), and a worker, called each
minute while work is waiting, writes them. The database hands out one job per point, so
nothing is paid for twice; a daily call cap and an outage pause bound the spend.
Opening a page never generates; a tutor's MCQ generate button runs that point's queue
job straight away. By hand, run it only through `bun scripts/practice-queue.ts`
(a dry run without `--yes`).

For Replace questions and the tutor's written-task drafts, the server loads the
specification point using the tutor's own database access; the queue, including the
generate button, has no signed-in user and uses the service credential. Reference
context is always retrieved with the service credential. Claude
receives the assembled context in the API request; it does not browse the repo,
read the local `papers/` directory, or connect to Postgres itself.

### Database setup

Apply these migrations, in order, before deploying the generation changes:

- `20260910120000_exam_exemplar_library.sql`
- `20260910150000_exam_generation_framework.sql`
- `20261005220000_practice_queue.sql`

The app server needs `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` and `PRACTICE_WORKER_SECRET`. The
queue's minute job reads the worker's address and the same secret from Supabase
Vault (`practice_worker_url`, `practice_worker_secret`); until both exist it calls
nothing. The service credential and
reference records stay server-side; the retrieval RPC is not executable by
anonymous or authenticated browser clients. Missing credentials/migrations are
configuration errors, not an empty-library fallback.

Populate `topics.specification_version` and `topics.exam_tier` when known. Null
means unrecorded: the prompt must not invent a version or assume Higher tier.
`spec_points.assessment_context` holds relevant specification-backed practical
and mathematical skills and scope notes. These fields currently have no new UI.

`exam_exemplars` supports shared introductions, source file/page references,
command words, assessment objectives, question formats and independent
mathematical/practical demand flags. `load-exemplars.ts` accepts these optional
fields plus an aligned `mark_scheme` on each JSON row. Legacy parser output is
still importable, but unresolved multipart schemes are flagged. Import does not
approve records. Changes to approved exemplar content invalidate that approval.
Source-paper extraction, AI-assisted library review and tagging remain separate
ingestion work; this framework does not run an ingestion model automatically.

### Retrieval and prompting

Only approved, unflagged examples with text, positive marks, a mark scheme and
no missing image are eligible. Board, qualification and subject must match.
Recorded version/tier constraints are respected. The database returns a bounded
pool from the exact point, surrounding topic and same-course style examples.
The prompt builder selects up to five complete, diverse examples within an
18,000-character reference budget; it never truncates a question's scheme to fit.

No exact match is required. Topic/style examples can support generation, with
style examples explicitly forbidden from expanding the curriculum scope. If
none qualify, the request uses the curriculum and available board guidance.
Practical and mathematical demand are variety attributes, not mandatory filters;
the same question may assess both, and unsuitable skills must not be forced in.

`exam_generation_guidance` stores source-linked board/qualification guidance.
The migration seeds concise GCSE AQA and Edexcel guidance. Other qualifications
use the common framework and their available exemplars until applicable guidance
is added; GCSE guidance is not silently reused for another qualification.

Past-paper text lost its small figures when it was copied out of PDFs ("H2O"),
and the model copies what it is shown, so examples go into the prompt in proper
notation, the prompt spells the notation out, and every field of the reply is
normalised before it is checked (see Science notation above).

The call returns schema-constrained JSON. Code rejects incomplete sets, empty
rubrics, invalid marks, duplicate prompts and malformed MCQ answer keys. For
written questions this checks structure, not scientific correctness, and there is
no second AI review or publishing gate. Questions retain their generated mark
schemes for marking.
Keep curriculum descriptions complete; a title alone provides much less guidance.

A multiple-choice question's key is checked, three ways
(`src/lib/mcq/answerCheck.server.ts`). A quiz once went live with no correct
option, keyed to an answer its own explanation called wrong.

- **The writer works first.** It judges each option right or wrong
  (`option_checks`) before it gives the key. A question is left out unless exactly
  one option is judged right and that option is the key.
- **A blind solve.** A different, cheaper model (Claude Haiku 5.5) answers every
  question without seeing its key. Where it disagrees, the writer's model (Claude
  Sonnet 5.5) answers that one question, also blind. A question neither answers
  with its key is left out. A quiz with fewer than five questions left is not
  saved, and its job tries again.
- **The database refuses the rest.** Each saved question names the blind solve
  that gave its key (`mcq_questions.checked_run_id`). A trigger refuses a new
  question in a generated quiz without one, whoever sends it. A tutor writing a
  question by hand is let through.

Questions saved before 16 Nov 2026 have no check: their `checked_run_id` is null.

`exam_generation_runs` has one row per model call, passed or failed, blind solves
included (format `mcq_check`; the queue's daily cap leaves these out): the model that
answered, framework version, selected exemplar IDs, fallback level, response
(including assessment tags), API usage, the outcome (passed, saved, discarded or
failed), and for a failed call its error and raw answer. These
records are tutor-readable only. Logging failure is reported server-side without
discarding an otherwise valid set. System-prompt caching is requested; actual cache
hits depend on the provider's minimum prompt length and cache lifetime.

### Verification

Run `bun test src/lib/homework/examGeneration.test.ts src/lib/homework/examGeneration.server.test.ts`
for reference selection, context isolation, fallback and mocked API checks.
Use a representative sample to compare future prompt/model versions before
deployment. Runtime validation cannot guarantee exam accuracy.
