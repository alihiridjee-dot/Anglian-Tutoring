# Generation brief: drafting a chapter of revision notes

This is the exact job given to a note-writing agent (Sonnet). One agent drafts
**one chapter** of one subject. Everything it needs is in this repository.

## Inputs

- `scripts/notes/WRITING_GUIDE.md` — the voice, the shape and the rules. Follow it.
- `src/lib/notes/noteFormat.ts` — the JSON format and the validator's rules.
- `scripts/notes/concepts/gcse-<subject>.json` — the chapter's concepts, in teaching order.
- `scripts/notes/.sources/<concept id>.json` — the spec wording and the past-paper
  questions with mark schemes, per board. **The only source of content.**
- `scripts/notes/trial/c/biology/` — five approved examples of the style. Match
  their structure and density, not their topics.

## The job

1. Build the chapter's source packs (read-only):
   `bun run scripts/notes/build-sources.ts <subject> "<Chapter name>"`
2. For each concept in the chapter, in order, write
   `scripts/notes/drafts/<subject>/<concept id>.json`. If that file already
   exists, it has been reviewed: leave it alone and move to the next concept.
3. After each note, validate just your notes (other writers work alongside you):
   `bun run scripts/notes/validate.ts <subject> --ids <your concept ids, comma-separated>`
   Fix every error before moving on.
4. When the whole chapter passes, stop and report. A separate science check
   then verifies and signs each note before it is published to students.

## Done means

- Every concept in the chapter has a note, and the validator passes all of them.
- Every board that has spec points in a concept has a board layer with its spec
  codes and a real worked example from that board's pack.
- An interactive (`predictor` or `slider`) wherever the topic genuinely fits.

## Do not

- Do not write an "Exam tips" section: no `exam_phrases` and no `mistakes` in
  any board layer. It was removed from every note and is not written any more.
- Do not edit anything outside your own notes in `scripts/notes/drafts/<subject>/`.
  Other writers are working on other chapters at the same time.
- Do not touch git, the database (beyond the read-only source script), or the network.
- Do not set `meta.checked_by`; only the science check signs a note.
- Do not use or imitate any textbook or revision guide.
- Do not invent exam questions or mark-scheme wording. Quote the pack, but put
  its science notation right (the pack's "H2O", "Mg2+" and "cm3" lost their
  small figures in the PDF copy: write H₂O, Mg²⁺, cm³). `validate.ts` flags any
  that are left.
- Do not skip a concept. If a pack is empty or unusable, write the note from the
  spec wording, give it only the boards that have spec points, omit the worked
  example, and say so in the report.

## The report

Short: notes written, validator result, and a list of anything a reviewer
should check (thin sources, contradictory mark schemes, content you were unsure of).
