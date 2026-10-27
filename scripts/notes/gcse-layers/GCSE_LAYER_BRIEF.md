# GCSE layer brief: give each board layer the detail its own spec points ask for

You are a note writer. The revision notes in this repository are one shared text per
concept (read by AQA, Edexcel and OCR GCSE students alike) plus a thin layer per board.
Most GCSE layers hold only spec codes and a worked example, so a student on one board
can miss detail that only their spec asks for. Your job: for each concept id in your
list, find what each GCSE board's spec points ask for that the note lacks, and add it
to that board's layer as short `extra` sections. The IGCSE layers already follow this
recipe (`scripts/notes/IGCSE_BRIEF.md`, job B); you are doing the same for the three
GCSE boards.

Run every command from the repository root you were given (never `cd` elsewhere).
Read first: `scripts/notes/WRITING_GUIDE.md` (voice, shape, notation, "Do not"). The
rules below are the ones that matter most for this job.

## Inputs per concept

- `scripts/notes/.sources/triage/gcse/<id>.md` — the triage pack (written by
  `scripts/notes/gcse-layers/slim-pack.ts`). Part 1 is everything the shared note
  already says (flattened). Part 2 lists, board by board, the board's existing layer
  (worked example, existing extra sections) and then its spec points, primary first,
  each with flags:
  - `HIGHER TIER (whole point)` or `HIGHER TIER (part only: "…")` — that board marks
    this content Higher tier. The flag is a heuristic: the spec wording decides. A
    description that says "(HT only)" after one sentence makes only that sentence
    Higher tier; a point whose title ends "(HT only)" is wholly Higher tier.
  - `SEPARATE SCIENCE ONLY …` — only that board's separate-science course has it
    (Edexcel code ending P/B/C; AQA points with no Trilogy twin or saying "physics only").
  - `PRIORITY: only N% of its words appear in the note` — a word match flagged this
    point as probably under-covered. Treat these as the priority list, but read every point.
  - `also covered here (non-primary)` — the point's main note is elsewhere; add only
    what falls inside this concept's scope.
- `scripts/notes/.sources/<id>.json` — the full pack: the same spec points plus past
  questions with mark schemes per board. Large. Open it only when a point's wording is
  unclear and a mark scheme would settle what examiners expect.
- `scripts/notes/drafts/<subject>/<id>.json` — the live note. Do not open it to edit; the
  tool below edits it for you.

## Step 1 — triage

For each board (aqa, edexcel, ocr; AQA Trilogy points count as aqa) and each of its spec
points, compare the point's wording with Part 1 plus that board's layer. Write down what
the point asks for that is missing: a named fact, example, term, definition, equation,
unit, practical method, graph shape, factor, explanation or distinction. Ignore command
words, "students should be able to", generic maths skills, and anything already present
in other words. Be strict about "already covered": if a student could answer the point
from the note as it stands, there is nothing to add.

Save the result as `scripts/notes/.sources/triage/adds/<id>.json`: a JSON array of
`{ "course": "aqa"|"edexcel"|"ocr", "code": "<spec code>", "add": "<one line: what to add>" }`.
An empty array is a valid result. Mark Higher-tier and separate-science items in the
`add` line so you remember them when writing.

## Step 2 — write the sections

For each board with items, write `scripts/notes/.sources/triage/extra/<id>.<board>.json`:
a JSON array of sections `{ "heading": "...", "blocks": [ ... ] }` to append to that
board's `extra`. Usually one section headed **"Detail this course asks for"**. Use two
sections with plainer headings (e.g. "Pressure in a fluid", "Core practical: …") only
when the items are two clearly different parts. Cover every adds item for that board.

Style — light, the way the shared note is written:
- Blocks: `list` (2+ items; the default), `definitions` (term + one-line meaning),
  `equation` (own box, with `label` and a `where` list giving each symbol and its unit),
  `steps` (`lead` + `text`, for a method or a calculation), `table`, `paragraph` (one
  sentence to signpost, at most 45 words, never two in a row), `subheading`. No diagrams,
  no `key-points`.
- Short: a section is typically 2 to 6 bullets or one definitions/equation block, up to
  about 120 words. Say the thing once, in GCSE words, at mark-scheme depth.
- **Bold** at most two terms a student must remember per bullet. No asides, no "remember",
  no exclamation marks. UK spelling.
- Science notation in Unicode: H₂O, CO₂, Mg²⁺, cm³, m/s², 3.0 × 10⁸, v². Never H2O or 10^8.
- Never write "AQA", "Edexcel", "OCR", "Trilogy", "Gateway", a paper, a year, or "this
  board". Say "this course" if you must. The tool refuses sections that name a board.
- Do not repeat the shared text or the layer's existing sections; do not re-explain the
  concept. Add only the missing detail.
- Content comes from the spec wording and the pack's mark schemes. Never from memory of a
  textbook or revision guide. Never invent numbers; if a value is needed and the pack does
  not give it, state the relationship without a number.

Labels (house style; put them at the start of the heading when they apply to the whole
section, otherwise at the start of each line they apply to):
- `(Higher tier)` where that board marks the content Higher tier. A board layer is read
  only by that board's students, so write the plain form "(Higher tier)", never
  "(AQA: Higher tier)".
- `(Separate science)` where the flag says SEPARATE SCIENCE ONLY for that board.
- Both: `(Higher tier, Separate science)`.
- Do not label OCR content separate-science: the data has no OCR combined course.

Practicals: AQA "Required practical activity", Edexcel "Core practical" and OCR "PAG"
points often ask for a method the note lacks. Add a short `steps` block of the key
steps and what is measured, under a heading such as "Required practical: …" or
"Core practical: …" or "Practical: …" (those words do not name a board). Take the steps
from the spec wording and the pack's mark schemes.

## Step 3 — apply

For each board file:
`bun scripts/notes/gcse-layers/add-extra.ts <subject> <id> <board> scripts/notes/.sources/triage/extra/<id>.<board>.json`
(add `--dry` first if you want to see the result). The tool appends the sections to that
layer, keeps the file's layout, validates the whole note, and refuses bad input: fix the
sections file and run it again. Never edit a draft file by hand, and never touch
`title`, `key_idea`, `sections`, `checks`, `meta` or any other layer. If a layer does
not exist for a board, do not create it; report it.

## Step 4 — validate

`bun run scripts/notes/validate.ts <subject> --ids <your ids, comma-separated>`
Fix every error that comes from your sections. A worked example "not in this concept's
questions" is a pre-existing problem: leave it and mention it. Fix every `notation:`
line that comes from text you wrote (leave pre-existing ones alone and mention them).

## Report (short)

For each concept: which layers gained sections (headings), and the adds items you
decided were already covered if you were unsure. Then: points you could not cover and
why; anything in the shared note that looks wrong against the spec (do not fix it);
anything the science checker should look at. Keep the report under 400 words.

## Do not

- Do not edit anything in `scripts/notes/drafts/` except through `add-extra.ts`, and only
  for the ids in your list. Other writers are working on other ids at the same time.
- Do not run git, load anything into the database, or call the network beyond the scripts named here.
- Do not set or change `meta.checked_by` / `meta.checked_at`.
- Do not pad: a board whose points are all covered gets nothing, and that is a good result.
