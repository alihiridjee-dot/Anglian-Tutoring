# Science check: the last gate before a note goes live

No person reviews these notes before students see them. This check is the
review. A note is published only once this check has signed it
(`meta.checked_by`), so be thorough and be strict.

One checker takes a list of drafted notes. For each note:

## Read

- The note: `scripts/notes/drafts/<subject>/<concept id>.json`
- Its source pack: `scripts/notes/.sources/<concept id>.json` (spec wording and
  past-paper questions with mark schemes, per board)
- `scripts/notes/WRITING_GUIDE.md` for the rules the note must follow

## Check, and fix in place

1. **Science.** Every statement is correct at GCSE level and consistent with the
   mark schemes in the pack. Watch for: wrong definitions, reversed cause and
   effect, wrong units, wrong numbers in examples, Higher-tier content not
   marked "(Higher tier)", and anything beyond the spec presented as required.
2. **Coverage.** Everything the concept's spec points ask for is in the note.
   Add what is missing, in the same light style.
3. **Worked examples.** Each board's question matches the pack's question for
   that `exemplar_id` (same question, accurate wording, any needed table or
   figure data included). `answer_points` follow that question's mark scheme.
   No paper, year or board appears anywhere a student sees.
4. **No exam tips.** No board layer has `exam_phrases` or `mistakes`; the
   "Exam tips" section is no longer written.
5. **Interactives give right answers.** Work each one through:
   - `practice`: compute the answer at both ends of every variable range; the
     formula is the real equation; the numbers are realistic; `decimals` is right.
   - `slider`: the formula is the real equation; values are realistic.
   - `predictor` / `sort` / `sequence` / `explorer` / `punnett`: every result,
     group, order and description is correct. A scene matches its result.
6. **Checks** (the three questions at the end) have correct answers.
7. **Style**: light, signposted, no walls of prose; UK spelling.
8. **Notation.** Formulas, ions, units and powers use Unicode subscripts and
   superscripts (H₂O, Mg²⁺, SO₄²⁻, cm³, 3.0 × 10⁸). Fix every "notation"
   line `validate.ts` prints.

If something can't be made right from the pack, cut it rather than guess.

## Sign

When a note is right, set in its `meta`:
`"checked_by": "sonnet-science-check"` and `"checked_at": "<today's date>"`.
Never sign a note you have not fully checked.

Validate your notes with exactly:
`bun run scripts/notes/validate.ts <subject> --ids <comma-separated ids>`
and fix until they pass.

## Do not

- Do not touch notes outside your list, or anything outside `scripts/notes/drafts/`.
- Do not run git or load anything into the database; the coordinator does that.

## Report

Short: notes signed, and for each note what you changed (one line each), and
any note you could not sign and why.
