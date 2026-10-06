# IGCSE brief: new notes and IGCSE layers

Read `GENERATION_BRIEF.md` and `WRITING_GUIDE.md` first; everything in them applies
(voice, shape, validator limits, "Do not"). This brief only says what is different for
IGCSE. There are two kinds of job. Your prompt says which concept ids you have.

IGCSE students are 14 to 16 and sit Cambridge IGCSE or Edexcel International GCSE.
Write "(Supplement)" at the start of a sentence or section that only Cambridge
Supplement points ask for (their codes end in S). Edexcel has no tiers: ignore its
B, C and P code letters.

## Layer keys

A board layer is keyed by course: `cambridge_igcse` and `edexcel_igcse` (GCSE keeps
`aqa`, `edexcel`, `ocr`). Never use `cambridge` or a bare `edexcel` for IGCSE.

## Source packs

- New note (an `ibio-`, `ichem-` or `iphys-` id):
  `bun run scripts/notes/build-sources.ts <subject> <concept id>`
- IGCSE layer on an existing GCSE note (a `bio-`, `chem-` or `phys-` id):
  `bun run scripts/notes/build-sources.ts <subject> <concept id> --only cambridge_igcse,edexcel_igcse`
  (this writes `scripts/notes/.sources/<concept id>.igcse.json`, the IGCSE courses only;
  read that file, not `<id>.json`)

The pack lists, per course, the spec points (`primary` or not) with their full
wording, and approved past questions with mark schemes. It is the only source of
content and of worked examples. Pack questions are for that course only.

## Job A: write a new note (IGCSE-only concept)

Write `scripts/notes/drafts/<subject>/<concept id>.json` exactly as for a GCSE note,
following GENERATION_BRIEF steps 1 to 4, with these differences:

- The concept is in `concepts/igcse-<subject>.json`. Its `scope` and spec points say
  what to cover. Cover every spec point's wording (read the pack, both courses).
- One layer for every course that has a spec point in the concept
  (`cambridge_igcse` and/or `edexcel_igcse`): `spec_codes` from the pack (primary
  ones first) and a real worked example from that course's pack questions. No exam
  tips. If a course has no usable question, omit the worked example and say so.
- `meta.spec_point_ids`: the primary spec point ids from the pack, from both courses.
- Never write "Cambridge", "Edexcel", paper names or years anywhere a student reads.

## Job B: add the IGCSE layer to a GCSE note

For each concept id: the note already exists and is live to GCSE students. **Do not
change anything GCSE students read**: leave `title`, `key_idea`, `sections`, `checks`
and the existing `boards` layers exactly as they are. Only add:

1. For every course that has refs in the pack, a new `boards.<course key>` layer:
   - `spec_codes`: that course's codes from the pack, primary ones first.
   - `worked_example`: if the course has a primary point in the concept, one question
     from that course's pack chosen as the guide says (3 to 6 marks, no image needed),
     with `exemplar_id`, `source`, `question`, `marks`, `answer_points`, optional
     `tip`. A course whose points are all non-primary refs needs `spec_codes` only.
   - `extra`: `scripts/notes/.sources/triage/adds/<concept id>.json`, if it exists,
     lists what the IGCSE points ask for that the shared note lacks (`course`,
     `code`, `add`). Write each as a short `extra` section for that course, headed
     "Detail this course asks for" (or a plainer heading if two parts), in the same
     light style (list, definitions, equation, steps). Check the note's text first:
     if the item is already there, skip it. Do not repeat the shared text. If both
     courses need the same item, put it in both layers.
2. `meta`: append the course's primary spec point ids to `meta.spec_point_ids` and the
   worked-example ids to `meta.exemplar_ids`. Leave `checked_by` as it is.

Read the spec wording in the pack. If a point asks for something the note and the
adds file both lack, add it to `extra` too (small things only) and say so in your report.

## Validate

`bun run scripts/notes/validate.ts <subject> --ids <your ids>`; fix every error and
every "notation" line.

## Report

Notes written or layered, the validator result, any course with no usable question,
any point you could not cover, and anything the science check should look at.
