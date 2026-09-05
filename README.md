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

- `SUBJECT_TINT[subject]` from `src/lib/subjectTheme.ts` for the three sciences
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
- Gemini API (`gemini-2.5-flash`) — MCQ generation
- Stripe — monthly subscriptions
- Microsoft Teams — live session scheduling
