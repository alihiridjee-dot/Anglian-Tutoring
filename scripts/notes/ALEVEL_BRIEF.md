# A-level brief: writing and checking A-level notes

Read `GENERATION_BRIEF.md` and `WRITING_GUIDE.md` first; everything in them applies
(voice, shape, validator limits, "Do not"). This brief only says what is different
for A-level. The science check follows `CHECK_BRIEF.md` with the differences at the end.

## Who it is for

A-level students, 16 to 18, sitting AQA, OCR (A), Edexcel (Biology A, Chemistry,
Physics) or Cambridge International A-level. Write at A-level depth, with A-level
vocabulary, in the same light style. Where the guide says "GCSE", read "A-level".
There are no tiers: never write "(Higher tier)". Do not label AS and A2 content.

## Concepts and layer keys

- Concepts are in `scripts/notes/concepts/alevel-<subject>.json`, ids `abio-`,
  `achem-`, `aphys-`. They are A-level only: never shared with a GCSE or IGCSE note.
- A board layer is keyed by course: `aqa_alevel`, `ocr_alevel`, `edexcel_alevel`,
  `cambridge_alevel`. Never a bare `aqa`, `ocr`, `edexcel` or `cambridge`.

## Source packs

`bun run scripts/notes/build-sources.ts <subject> "<Chapter name>"` (or one concept id)
writes `scripts/notes/.sources/<concept id>.json`. The library holds **no A-level
past-paper questions yet**, so a pack has the spec points only (full wording, per
course, `primary` or not). The spec wording is the only source of content.

## The note

- Cover the wording of every **primary** spec point in the pack, from every course.
  Non-primary points are taught in another note: touch them in a sentence at most.
- Content two or more courses ask for goes in the shared `sections`. Detail that
  only one course asks for goes in that course's `boards.<key>.extra`, headed
  "Detail this course asks for" (or a plainer heading), in the same light style.
- One layer per course that has a spec point in the concept: `spec_codes` from the
  pack, primary ones first. **No `worked_example`** (there are no questions to
  cite; never invent one), no `exam_phrases`, no `mistakes`.
- `checks`: three questions at A-level standard, answers as a mark scheme would credit.
- `meta`: `status: "draft"`, `written_by`, `written_at`, `spec_point_ids` (the primary
  ids from the pack, every course), `exemplar_ids: []`. Never set `checked_by`.
- Interactives: as the guide says; `slider` and `practice` numbers must be
  realistic at A-level and the formula must be the real equation.
- Never write a board, course, paper or year anywhere a student reads.

Validate with `bun run scripts/notes/validate.ts <subject> --ids <your ids>`; fix every
error and every "notation" line.

## Science check differences

- Check the science at A-level, against the spec wording in the pack (there are no
  mark schemes). Every primary point of every course must be answerable from the
  shared note plus that course's `extra`; compare the wording point by point and add
  what is missing in the light style.
- No layer has a `worked_example`, `exam_phrases` or `mistakes`.
- Course-only detail sits in that course's `extra`, not in the shared sections.
- Sign as `CHECK_BRIEF.md` says.
