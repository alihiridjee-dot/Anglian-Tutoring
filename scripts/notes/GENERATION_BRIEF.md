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
3. After each note, validate it:
   `bun run scripts/notes/validate.ts <subject>`
   Fix every error before moving on.
4. When the whole chapter passes, stop and report.

## Done means

- Every concept in the chapter has a note, and the validator passes all of them.
- Every board that has spec points in a concept has a board layer with real
  exam phrases, real mistakes and a real worked example from that board's pack.
- An interactive (`predictor` or `slider`) wherever the topic genuinely fits.

## Do not

- Do not edit anything outside `scripts/notes/drafts/<subject>/`.
- Do not touch git, the database (beyond the read-only source script), or the network.
- Do not use or imitate any textbook or revision guide.
- Do not invent exam questions or mark-scheme wording. Quote the pack.
- Do not skip a concept. If a pack is empty or unusable, write the note from the
  spec wording, give it only the boards that have spec points, omit the worked
  example, and say so in the report.

## The report

Short: notes written, validator result, and a list of anything a reviewer
should check (thin sources, contradictory mark schemes, content you were unsure of).
