# Writing a revision note

This is the brief every note is written to, by a person or by Claude. The format
itself is `src/lib/notes/noteFormat.ts`; `scripts/notes/validate.ts` checks it.

## Who it is for

A GCSE student, 14 to 16, revising alone. They have watched the video. They want
to understand the idea and then pick up the marks. Write so that a student who
missed the lesson could learn the topic from this note alone.

## The voice

- **Comprehensive but simple.** Cover everything the spec points ask for, at the
  depth the mark schemes reward, and nothing beyond it.
- **Light, not bulky.** A student should be able to scan a section in seconds and
  see its structure. Paragraphs are one to three short sentences (45 words at
  most) and never more than two in a row; the validator enforces both.
- **Bullets over prose.** Facts, features, conditions, examples and comparisons
  go in a `list`. Prose is only for the "because" that joins facts together.
- **Signpost.** Open each section with one sentence saying what it covers. Use a
  `subheading` when a section has two distinct parts.
- **Key words go in a `definitions` panel** where they are first needed, not in
  the middle of a paragraph. Meanings are one line each.
- **Every equation or formula goes in its own `equation` box**, never inside a
  sentence. Give a `label` ("Magnification", "Percentage change in mass") and a
  `where` list with each term and its unit. A calculation that follows it is a
  `steps` block.
- **End each main section with `key-points`**: two to four lines a student should
  take away.
- Short sentences. One idea per sentence. Plain words.
- **Bold** only the terms a student must remember, at most two per paragraph or
  bullet. No other formatting.
- No asides, no jokes, no "remember…" or "top tip". No exclamation marks.
- UK spelling and GCSE vocabulary (e.g. "partially permeable membrane").
- Never copy wording from a textbook or revision guide. The sources are the spec
  and the mark schemes, nothing else.

## The shape

1. **key_idea** — two or three short sentences (under 50 words) a student could
   repeat back.
2. **sections** — usually 2 to 4, each with a plain heading ("How osmosis works",
   "Osmosis in plant and animal cells"). Together they teach the whole concept.
3. **One diagram**, where a picture genuinely helps. Choose the kind that fits:
   - `line-graph` for something that changes along an axis. y is 0–1 (shape, not
     data); label x with real units (put the unit in `x.unit`, not in the ticks).
     For a quantity that goes negative (change in mass), set `y.zero` to where
     zero sits on the 0–1 scale. Up to 5 series.
   - `flow` for a process or a cycle (`loop: true`), 2 to 7 short boxes.
   - `compare` for two to four things set side by side.
   - `predictor` (interactive): "pick one and see what happens". Use it when the
     topic is about predicting an outcome from a choice: electrolysis products,
     flame tests, displacement, genetic crosses, which test identifies which ion.
     2 to 10 options, each with the same `result_labels` rows.
   - `slider` (interactive): "move a slider and watch it change". Use it when a
     GCSE equation links the quantities: stopping distance, rate, magnification,
     energy, power, density, SA:V. Inputs are sliders (`min`/`max`/`step`/`value`)
     or named `choices`; each output has a `formula` using only the input ids and
     + - * / ^ ( ) sqrt abs min max. Mark outputs `bar: true` to stack them in a bar.
     Values must be realistic for GCSE and the formula must be the real equation.
   - `sequence` (self-test): "put these steps in order". For any real sequence a
     student must recall: cell cycle stages, a practical's method, the reflex arc,
     blood flow through the heart. 3 to 8 steps, given in the correct order.
   - `sort` (self-test): "sort these into groups". For classification the mark
     schemes test: eukaryotic/prokaryotic, thinking/braking distance factors,
     exothermic/endothermic. 2 or 3 groups, 4 to 12 short items.
   - `punnett` (interactive): a single-gene cross with dominant and recessive
     alleles, including genetic disorders and sex determination (X/Y).
   - `practice` (self-test): a calculation with new numbers each time. Use it
     for every equation students must apply (magnification, SA:V, moles, V = IR,
     density, speed…). `question` and `working` use {id} and {answer}; ranges
     must give sensible GCSE numbers; set `decimals` to what a mark scheme expects.
   - `explorer` (self-test): "tap a part to learn its job, then test yourself".
     For named parts with functions: cell structures, the heart, the eye, the
     kidney. 3 to 12 parts, each detail one or two sentences.

   **Scenes** make an interactive visual: an illustrated picture the app draws,
   which you only fill in. Use one whenever it fits the topic (see
   `scripts/notes/trial/templates/` for real JSON):
   - on a `predictor` option (every option then needs one):
     `electrolysis` (cell with products), `tubes` (test tubes with colours,
     precipitates, bubbles: food tests, indicators, ion tests), `flame` (flame
     tests), `energy-profile` (exothermic / endothermic, optional catalyst path).
     Colours must be from `SCENE_COLOURS` in noteFormat.ts.
   - on a `slider`: `road` (stopping distance), `wave` (amplitude, frequency),
     `particles` (states of matter vs temperature), `half-life` (decaying nuclei
     vs time), `gas-syringe` (gas collected: rates), `circuit` (bulbs in series or
     parallel), `enzyme` (active site vs temperature or pH), `diffusion`
     (concentrations either side of a membrane), `ph` (universal indicator scale).

   Choosing: give each note **one interactive** wherever one genuinely fits,
   picking the template that matches what students are examined on (recall a
   sequence → `sequence`; apply an equation → `practice` or `slider`; predict an
   outcome → `predictor`; name parts → `explorer`). Don't force one. Never more
   than two diagrams in a note.
4. **checks** — three short questions a student can answer from the note, with
   answers written the way a mark scheme would credit them.
5. **boards** — one layer for every board that has a spec point in the concept:
   - `spec_codes`: that board's codes from the source pack (primary ones first).
   - Do **not** write `exam_phrases` or `mistakes`. The "Exam tips" section was
     removed from every note and must not be written for new notes.
   - `worked_example`: one question from that board's questions in the pack,
     chosen to show the core idea (prefer 3 to 6 marks, no image needed). Copy the
     question accurately, give `answer_points` that follow its mark scheme, and
     cite `exemplar_id` and `source` exactly. `source` is kept for our records
     and is never shown to students, so don't mention the paper, year or board
     anywhere a student sees it (question, answer points, tip). If the question
     says "Figure 3" or "Table 2", either include what it shows in the question
     text or choose another question.
   - `extra`: only for content this board alone requires.
6. **meta** — `status: "draft"`, `written_by` (the model or the person),
   `written_at` (ISO date), `spec_point_ids` (the primary ids from the pack) and
   `exemplar_ids` (every question you used).

## Scope

Stay inside the concept's spec points. If a neighbouring concept covers
something, mention it in a sentence at most. Higher-tier-only content is fine
inside the note; say "(Higher tier)" at the start of the sentence or section.
