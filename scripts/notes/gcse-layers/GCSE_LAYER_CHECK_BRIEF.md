# Science check for new GCSE layer sections

No person reviews these notes before students see them: this check is the review.
A writer has appended `extra` sections to the AQA, Edexcel and OCR layers of the notes
in your list, following `GCSE_LAYER_BRIEF.md` (same folder as this file; read it so you
know the rules the writer worked to). You verify, fix in place, and sign.

Run every command from the repository root you were given (never `cd` elsewhere).
Your prompt names the git base (a commit or tree) the writers started from.

## For each concept id

1. See what was added: `git diff <base> -- scripts/notes/drafts/<subject>/<id>.json`.
   Only `extra` sections appended to `boards.aqa`, `boards.edexcel` and `boards.ocr` may
   appear in the diff. If anything else changed (title, key_idea, sections, checks,
   another layer, meta, an existing extra section), restore it from
   `git show <base>:scripts/notes/drafts/<subject>/<id>.json` and report it.
   A note with no diff has nothing new: check that the writer's triage was right
   (step 3, coverage) and otherwise leave it unsigned.
2. Read the triage pack `scripts/notes/.sources/triage/gcse/<id>.md`: Part 1 is the
   shared note, Part 2 each board's spec points with Higher-tier / separate-science /
   PRIORITY flags. The writer's own triage is in `scripts/notes/.sources/triage/adds/<id>.json`.
   The full pack with mark schemes is `scripts/notes/.sources/<id>.json` (large; open a
   board's questions when a mark scheme would settle a doubt).
3. Check each new section, strictly:
   - **Science.** Every statement is correct at GCSE level and agrees with the spec
     wording and the pack's mark schemes. Fix wrong definitions, reversed cause and
     effect, wrong units, wrong numbers, anything beyond GCSE presented as required.
     Cut what cannot be made right from the pack rather than guess.
   - **Coverage.** For that board, every spec point in Part 2 is now answerable from the
     shared note plus the layer. Compare the wording point by point (primary points
     especially; a non-primary point only inside this concept's scope). Add what is
     missing, small things only, in the same light style, to the new section (or a new
     section if the layer has none).
   - **Labels.** Content a board marks Higher tier starts with "(Higher tier)" (heading
     or line); SEPARATE SCIENCE ONLY content with "(Separate science)"; both with
     "(Higher tier, Separate science)". Plain forms only inside a layer: never
     "(AQA: Higher tier)". Nothing is labelled Higher tier that the board does not mark.
     The pack's flags are heuristics: the spec wording decides. A description that
     says "(HT only)" after one sentence makes only that sentence Higher tier, even
     when the flag says "whole point"; a point whose title ends "(HT only)" is wholly
     Higher tier.
   - **No duplication.** The section does not repeat Part 1 or the layer's existing
     sections. Remove repeated lines.
   - **Style.** Light: lists, definitions, equation boxes with `where` units, steps.
     Paragraphs ≤ 45 words, never two in a row. Bold at most two terms per bullet. UK
     spelling. Unicode notation (H₂O, cm³, 10⁸). No board, paper or year named anywhere.
     No "remember", no exclamation marks.
   - **Equations** are the real GCSE equations with the right symbols and units.
4. Fix by editing the draft file's new section text directly with precise string edits
   (the Edit tool): change only text inside the new sections, keep the JSON layout as it
   is, and keep the file valid JSON. To append a further section use
   `bun scripts/notes/gcse-layers/add-extra.ts <subject> <id> <board> <sections.json>`.
5. Sign: set `meta.checked_at` to today's date in the draft (edit the existing
   `"checked_at": "..."` value only; leave `checked_by` as it is). Sign only a note
   whose new sections you have fully checked. Do this for every note in your list that
   gained sections.
6. Validate: `bun run scripts/notes/validate.ts <subject> --ids <your ids>` and fix
   until every note passes, except a worked example "not in this concept's questions",
   which is pre-existing: leave it. Fix every `notation:` line that comes from new text.
7. Gate: `bun scripts/notes/gcse-layers/gate.ts <subject> --base <base> --ids <your ids>`
   must report 0 violations.

## Do not

- Do not touch notes outside your list, or anything outside `scripts/notes/drafts/`
  except the sections files under `scripts/notes/.sources/triage/`.
- Do not run git commands that change anything (diff and show only); do not load
  anything into the database.
- Do not rewrite a section that is right; small, exact fixes only.

## Report (under 300 words)

Per note: signed or not; what you changed (one line each); points still not covered
and why. Then anything in the shared note that looks wrong against the spec (do not fix it).
