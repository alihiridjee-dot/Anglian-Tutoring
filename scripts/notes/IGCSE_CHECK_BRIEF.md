# Science check for IGCSE notes

Follow `CHECK_BRIEF.md` in full (science, worked examples, interactives, checks, style,
notation, signing). Differences for IGCSE:

- Layer keys are `cambridge_igcse` and `edexcel_igcse`. The pack for an existing GCSE
  note is built with
  `bun run scripts/notes/build-sources.ts <subject> <id> --only cambridge_igcse,edexcel_igcse`;
  a new IGCSE note's pack with `... <subject> <id>`.
- **New IGCSE note** (`ibio-`, `ichem-`, `iphys-`): check it entirely, and check that it
  covers every spec point's wording for both courses.
- **GCSE note with an IGCSE layer added**: check the new layer(s) only:
  1. `spec_codes` are right and primary ones are first.
  2. The worked example matches the pack question for its `exemplar_id`, is accurate,
     and its `answer_points` follow that mark scheme.
  3. **Coverage**: every IGCSE spec point of each course in the pack is answerable from
     the shared note plus that layer's `extra`. Compare the point wording, one by one.
     Add what is missing to `extra` (small things only; keep the light style); do not
     edit the shared text. If something big is missing, cut nothing and report it.
  4. `extra` science is correct at IGCSE level and in the light style; the note does
     not mention a board, paper or year anywhere a student reads.
  5. The shared parts (`title`, `key_idea`, `sections`, `checks`, existing layers) are
     unchanged from `git show HEAD:scripts/notes/drafts/<subject>/<id>.json`. If a
     writer changed them, restore them and report it.
- Sign every note you fully checked: set `meta.checked_at` to today's date, and
  `meta.checked_by` to `"sonnet-science-check"`. Never sign a note you did not check.
- Validate with `bun run scripts/notes/validate.ts <subject> --ids <ids>`.
