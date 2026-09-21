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
| `.sticker` / `.sticker-alt`   | A chip slapped on at an angle. Celebration only — four is none   |
| `.eyebrow`                    | The micro-label above a heading (`.eyebrow-bare` drops its rule) |
| `.icon-tile`                  | The rounded square an icon sits in                               |
| `.btn-premium` / `.btn-solid` | The pressable chassis. Buttons travel down into their shadow     |
| `.numeral`                    | Display-type tabular figures, for counts and stats               |
| `.page-aurora`                | The page-level wash                                              |

`src/components/Shared.tsx` holds the composed pieces — `PageHeader`,
`SectionHeading`, `EmptyState`, `Spinner`, `Meter`, `Ring`, `StatTile`,
`Milestone`. Use them rather than rolling a heading, a progress bar or a
loading state per screen; every one of those had drifted apart before they
existed. `src/components/Doodles.tsx` holds the mascot cast, and it belongs in
empty states, milestones and the 404 — not inside a working tool.

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

## Tech

- React 19, TanStack Start v1, Tailwind CSS v4, TypeScript strict
- Supabase — Auth, Postgres with RLS, Storage
- Anthropic Claude — written question and MCQ generation
- Stripe — monthly subscriptions
- Microsoft Teams — live session scheduling

## Exam question generation

The framework lives in `src/lib/homework/examGeneration.ts`; its database and Claude calls
live in `src/lib/homework/examGeneration.server.ts`. Both the written-homework generators
(including automatic planner homework) and all three MCQ generators use it.
There is one model call per generated set for a specification point. Existing
publishing paths and the reuse of already-generated homework are retained.

The server loads the specification point using the signed-in user's database
access, then retrieves reference context using its service credential. Claude
receives the assembled context in the API request; it does not browse the repo,
read the local `papers/` directory, or connect to Postgres itself.

### Database setup

Apply these migrations, in order, before deploying the generation changes:

- `20260910120000_exam_exemplar_library.sql`
- `20260910150000_exam_generation_framework.sql`

The app server needs `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY`. The service credential and
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

The call returns schema-constrained JSON. Code rejects incomplete sets, empty
rubrics, invalid marks, duplicate prompts and malformed MCQ answer keys. This
checks structure, not scientific correctness, and introduces no second AI review
or new publishing gate. Questions retain their generated mark schemes for marking.
Keep curriculum descriptions complete; a title alone provides much less guidance.

`exam_generation_runs` records the model, framework version, selected exemplar
IDs, fallback level, response (including assessment tags) and API usage. These
records are tutor-readable only. Logging failure is reported server-side without
discarding an otherwise valid set. System-prompt caching is requested; actual cache
hits depend on the provider's minimum prompt length and cache lifetime.

### Verification

Run `bun test src/lib/homework/examGeneration.test.ts src/lib/homework/examGeneration.server.test.ts`
for reference selection, context isolation, fallback and mocked API checks.
Use a representative sample to compare future prompt/model versions before
deployment. Runtime validation cannot guarantee exam accuracy.
