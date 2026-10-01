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
- Short sentences. One idea per sentence. Plain words; define a scientific term
  the first time it is used, in the sentence that uses it.
- Prose first. Use a list, steps or a table only when the content really is a
  list, a sequence or a comparison.
- **Bold** only the terms a student must remember. Two or three per paragraph at
  most. No other formatting.
- No asides, no jokes, no "remember…" or "top tip". No exclamation marks.
- UK spelling and GCSE vocabulary (e.g. "partially permeable membrane").
- Never copy wording from a textbook or revision guide. The sources are the spec
  and the mark schemes, nothing else.

## The shape

1. **key_idea** — two or three sentences a student could repeat back.
2. **sections** — usually 2 to 4, each with a plain heading ("How osmosis works",
   "Osmosis in plant and animal cells"). Together they teach the whole concept.
3. **One diagram**, where a picture genuinely helps. Choose the kind that fits:
   - `line-graph` for something that changes along an axis. y is 0–1 (shape, not
     data); label x with real units. Up to 5 series.
   - `flow` for a process or a cycle (`loop: true`), 2 to 7 short boxes.
   - `compare` for two to four things set side by side.
   Leave it out if no diagram earns its place. Never more than two.
4. **checks** — three short questions a student can answer from the note, with
   answers written the way a mark scheme would credit them.
5. **boards** — one layer for every board that has a spec point in the concept:
   - `spec_codes`: that board's codes from the source pack (primary ones first).
   - `exam_phrases`: 3 to 6 phrases lifted from that board's mark schemes in the
     source pack, short enough to quote. These are the words that score.
   - `mistakes`: 2 to 4, each `wrong` (what students write, as a sentence) and
     `right` (the correction, one or two sentences). Base them on what the mark
     schemes reject or ignore.
   - `worked_example`: one question from that board's questions in the pack,
     chosen to show the core idea (prefer 3 to 6 marks, no image needed). Copy the
     question accurately, give `answer_points` that follow its mark scheme, and
     cite `exemplar_id` and `source` exactly.
   - `extra`: only for content this board alone requires.
6. **meta** — `status: "draft"`, `written_by` (the model or the person),
   `written_at` (ISO date), `spec_point_ids` (the primary ids from the pack) and
   `exemplar_ids` (every question you used).

## Scope

Stay inside the concept's spec points. If a neighbouring concept covers
something, mention it in a sentence at most. Higher-tier-only content is fine
inside the note; say "(Higher tier)" at the start of the sentence or section.
