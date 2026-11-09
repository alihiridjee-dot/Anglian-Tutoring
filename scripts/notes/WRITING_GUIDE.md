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
  sentence. Give a `label` ("Magnification", "Percentage change in mass"). A
  calculation that follows it is a `steps` block.
- **Point, don't describe.** Say what each part of a formula is with `arrows`,
  not sentences: each arrow puts a short label on the characters it names, and
  the page draws the arrow. Use them to cut words, never to add them.
  - One to four arrows. A label is a few words, at most 7 (44 characters):
    "Mass (kg)", "Balancing number: you can change it", "Solid".
  - `point` is the characters exactly as the formula writes them: `"m"`, `"₂"`,
    `"(aq)"`, `"²³⁸"`, `"size of image"`. If they appear more than once, add
    `in`, a stretch of the formula round them that appears once: the small 2 in
    water is `{ "point": "₂", "in": "2H₂O" }`. The validator says when a point
    is missing or ambiguous.
  - Physics and maths equations: one arrow per symbol, its quantity and unit
    ("Speed (m/s)"). That replaces the `where` list.
  - Chemistry: arrows on the parts students mix up: balancing number vs the
    small number in a formula, ion charges, state symbols, mass and atomic
    number. A sentence that only says what such a part is becomes an `equation`
    box with arrows (a short example formula like `2H₂O` is fine).
  - `where` is only for what an arrow can't say (an atom count, "g is 9.8 N/kg
    on Earth"), at most two lines. Don't repeat a unit or a meaning already given
    above, or that the steps or a list just below say.
  - Keep labelled formulas short. A word equation is fine; a long one may wrap
    on a phone, and then the page lists the labels under it instead.
  - No arrows on a box whose symbols were labelled in a box just above (a
    rearranged form): leave it bare.
- **Write science notation properly**, with Unicode subscripts and superscripts:
  H₂O, CO₂, Al₂(SO₄)₃, Mg²⁺, SO₄²⁻, e⁻, cm³, mol/dm³, m/s², 3.0 × 10⁸, v².
  Never H2O, Mg2+, cm3 or 10^8. Source packs are copied from PDFs, which lose
  the small figures, so a quoted question may read "H2O": write it as H₂O.
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
     Where two neighbouring steps could honestly go either way round (weigh the
     food or measure the water first; the rod gains electrons as the cloth loses
     them), mark them with `free: [[first, last]]` so a right method is never
     marked wrong; otherwise reword the steps until only one order is right.
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
     parallel), `enzyme` (active site vs temperature or pH; set `factor`, because
     a cold enzyme is slow, never denatured), `diffusion`
     (concentrations either side of a membrane), `ph` (universal indicator scale).

   **Figures** are real pictures with real values, drawn by the same code as
   exam-question figures and held to the same checker: `{ kind: "figure", title,
   alt, brief }`, where `brief` is written exactly as `src/lib/figures` describes
   for that kind (graph or scatter with real axes, bar chart, reaction profile,
   chromatogram, wave, forces, ray diagram, field pattern, displayed formula,
   dot-and-cross, electron shells, particle diagram, periodic-table outline, EM
   spectrum, moments, scale, pyramid, family tree, flow diagram, timeline…).
   Not circuits or food webs: a model draws those. Use a figure wherever an exam
   paper or textbook would show that picture, with the note's own numbers and
   labels. Figures don't count toward the limit below; give a note at most two.

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
