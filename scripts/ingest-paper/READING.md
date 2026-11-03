# Reading an exam paper

Turn a question paper and its mark scheme into rows for `exam_exemplars`.

## 1. Check they are the same paper

Every board prints its specification code on the page — `1PH0/1F`, `J247/01`,
`8463/1H`, `8464/B/1F`, `0625/42`, `9203/1`. It must match on both documents.
Filenames lie, and a question paper read against another subject's mark scheme
produces rows that look fine and are silently wrong.

That code is also the output filename, and the loader takes provenance from it:

    papers/<board>-<subject>-<level>-<year>-<sitting>-p<paper><tier>.json
    papers/edexcel-physics-gcse-2018-jun-p1F.json

A Cambridge paper keeps its whole component, `p42` for `0625/42`: paper 4,
variant 2, a different paper from `p41`. AQA Trilogy is filed by its subject at
the `gcse_trilogy` level, so `8464/B/1F` is `aqa-biology-gcse_trilogy-…-p1F`.

The sitting is `jan`, `mar` (February/March), `jun` (May/June) or `nov`
(October/November), read off the paper: the date it was sat on the cover, the
series on the mark scheme. It is not optional. The international boards set
the same paper number more than once a year, so a paper filed under the wrong
sitting overwrites a different paper. When the two documents disagree — 2020's
cancelled May papers were sat in November, so the paper says May and its mark
scheme says November — the mark scheme is when it was actually sat, but check
that it really is that paper's scheme before trusting it.

A sample or specimen paper was never sat, so it has no sitting and no year: file
it as `sample` with the year `unknown`, `ocr-biology-gcse-unknown-sample-p1`.
Only when the documents themselves say sample or specimen — a paper whose date
is merely missing is still checked against its mark scheme.

## 2. Draft the rows from the page

    python3 -E -P scripts/ingest-paper/extract_paper.py QP.pdf MS.pdf            # what it found
    python3 -E -P scripts/ingest-paper/extract_paper.py QP.pdf MS.pdf --draft > papers/<stem>.json

The report says whether the paper reconciles: every part found by its printed
label, its printed marks adding up to each question's total and the paper's,
and each part matched to its own mark scheme entry. Read anything it lists
under `!` before going on.

`--draft` writes the rows in the shape below, cut at the page's own labels, so
every prompt and scheme starts out verbatim. Sub- and superscripts are kept
(CaCO₃, 10⁻⁷, Fe³⁺), drawn reaction arrows are put back (→, ⇌), and the mark
scheme is split by its table columns, answer first then `Guidance:`. Parts that
need a figure are already in `skipped`, with the reason. A draft is a starting
point, not a reading: work through section 4 on it.

`split_paper.py --text` is the older way in, the raw text layer; it is still a
quick look at a paper the extractor cannot read.

`-E -P` keeps the downloads folder off Python's import path while still
finding pymupdf.

## 3. Check the index

The draft's labels and marks come from the page. Look at the report: a part
with no marks, a question whose parts do not add up, a scheme entry with no
part. If the paper does not reconcile, find out why on the page before
trusting any row.

## 4. Write the rows

One row per answerable part. `7(a)`, `7(b)(i)`, `7(b)(ii)` is three rows.

**Transcribe. Never compose.** Every word of a prompt, an option or a mark
scheme must appear in the documents. Do not reword, complete or correct
anything, however mangled the extraction is. If a question cannot be
represented faithfully, skip it and say why — inventing the missing half is the
one unrecoverable mistake, because the mark scheme still says the answer is B.

**Skip anything that needs a figure.** A graph, diagram, photograph, or a table
that only exists as an image. Do not transcribe it, do not describe it, do not
work around it. Put its label, marks and reason in `skipped` and move on. That
is roughly 40% of a paper and none of it is usable yet.

```
`label` — as printed: `7`, `7(a)`, `7(b)(ii)`, `04.3`
`q` — the question number alone: `7`
`shared_context` — the stem the parts share: scenario, data table, extract.
  Verbatim, repeated on every part that needs it. A prompt must never depend on
  text left behind. Null if there is none
`prompt` — this part's question text, verbatim. No shared stem, no printed
  marks, no dotted answer lines, no "Your answer"
`options` — multiple-choice options as printed. Null otherwise. Never write
  your own
`marks` — as printed for this part
`mark_scheme` — this part's own answer and marking notes, verbatim, including
  accept/allow/ignore and error-carried-forward. Not the whole question's, and
  not a sibling part's
`command_word` — Describe, Explain, Calculate, State, Evaluate, Suggest,
  Compare. Null if none
`assessment_objectives` — only if the scheme prints them. Normalise `AO 2 1` to
  `["AO2.1"]`. Empty otherwise
`question_format` — `mcq` when options are printed, else `written`
`specification_version` — the spec code: `1PH0`, `J247`, `8463`
`mathematical_demand` — does answering require calculation
`practical_demand` — does answering draw on practical technique
`spec_points` — the spec points this part credits, as codes without the board
  prefix: `["1.6", "6.4"]`. See "Tag each row as you write it" below. Omit it
  rather than guess
`flags` — empty when the row is complete and faithful. Otherwise what is wrong:
  garbled text, the scheme does not cover this part. A flagged row is never
  approved
```

Ignore anything that is not a question: covers, candidate instructions, formula
sheets, periodic tables, blank pages, "Turn over", footers.

### Tag each row as you write it

Each course's codes, with the topic and the point's own wording, are in
`papers/spec-points/<board>-<subject>-<level>.tsv`. Tag from that list, never
from memory: a code that is not in it does not exist.

An untagged question grounds a generated question by style only — same board,
same subject, any topic. A tagged one grounds it by the spec point itself, which
is the whole value of the library. You are already reading the question, so
decide then: put the codes in `spec_points` on the row and `load-exemplars.ts`
writes the links with everything else.

The point is what the question _credits_: a calculation set in a photosynthesis
investigation is tagged to photosynthesis, and a question that only tests method
with no content is better left untagged than forced into a point. Two or three
codes is usually the honest answer; more is a sign the question is being
stretched to fit. Codes go in without their board prefix — `1.6`, not `AQA 1.6`.
The prefix is everything before the number, so the letters that follow it stay:
`1.1.5S` for `CAIE 1.1.5S`, `3.1.5eB` for `OXAQA 3.1.5eB`, `1.2P` for
`IGCSE 1.2P`, `C1.1a` for `OCR C1.1a`.

A code that doesn't exist is reported, never guessed at, and the rest of the
paper still loads.

`load-tags.ts` is the back door for the papers read before this existed, and for
correcting a tag without re-reading a paper. Tag files live in `tags/<same paper
name>.txt`, one rule per line — labels, then codes:

    01.1,01.2 1.6,6.4
    03.6 2.2

    bun run scripts/ingest-paper/load-tags.ts scripts/ingest-paper/tags/*.txt
    bun run scripts/ingest-paper/load-tags.ts scripts/ingest-paper/tags/*.txt --write

Preview first. Either route replaces that paper's tags rather than adding to
them, so a correction is the whole edit.

## 5. Un-interleave the mark schemes

Mark schemes print as a table — answer in one column, examiner guidance in
another — and extraction weaves them together line by line, cutting sentences in
half. Put the columns back: answer first, then guidance after a `Guidance:`
line. Keep both. This is the only reordering allowed.

Before:

> substitution (1) (3) (F =) 0.10 x 2.0 AO 2 1 100 x 2 (using 0.10kg = 100g)
> reject 0.10 x 2.02 and the follow up evaluation

After:

> substitution (1) (F =) 0.10 x 2.0 · evaluation (1) 0.2(0) · unit (1) N
> Guidance: reject 0.10 x 2.02 and the follow-up evaluation; correct answer
> without working gets 2 marks

## 6. Check the rows against the page

    python3 -E -P scripts/ingest-paper/check_rows.py papers/<stem>.json            # report
    python3 -E -P scripts/ingest-paper/check_rows.py papers/<stem>.json --write    # write its flags into the rows

This holds every row to the documents:

- the label is a part the paper prints, and the marks are its printed marks
- every line of the prompt, the shared stem and each option is on the page, in
  the same question. Not composed, not borrowed from another question
- every line of the mark scheme is in that part's own entry. Marks such as
  `(1)` are ignored, and a scheme put back in reading order (a stacked
  fraction written with `/`, guidance regrouped) passes as long as its words
  are all that part's own
- a part that needs a figure is in `skipped`, not kept as text
- a multiple-choice answer names a printed option
- every part is a row or a skipped entry, and the marks add up
- every spec point code is in the course's list

Fix what it finds and run it again. What you cannot fix stays flagged, and a
flagged row is never approved. The check replaces its own flags each time and
leaves the reader's alone.

If the figure detector is wrong about a part, because the picture is decoration
and the question stands without it, keep the row and say why on it:
`"figure_checked": "photo of the apparatus only; every value is in the text"`.
Never use it to keep a question that cannot be answered without the figure.

A fraction or formula the text layer stacks out of order (the draft flags it)
may be written in reading order from the page, `5.450 / 5.600`, with
`"page_checked": "fraction written on one line"` on the row. Its words and
numbers must all still be the question's own.

Never adjust marks or text to make a check pass.

## 7. Load it

    bun run scripts/ingest-paper/load-exemplars.ts papers/<stem>.json
    bun run scripts/ingest-paper/load-exemplars.ts papers/<stem>.json --write

The paper and its rows move to `papers/done/` once they are in.

## Output shape

```json
{
  "profile": "read-in-session",
  "rows": [
    {
      "label": "4(c)",
      "q": "4",
      "shared_context": "A skier descends through a vertical height of 200 m...",
      "prompt": "Describe how her speed at the bottom of the slope could be determined.",
      "options": null,
      "marks": 3,
      "mark_scheme": "measure a distance (1)...\nGuidance: allow a light gate...",
      "command_word": "Describe",
      "assessment_objectives": ["AO2.2"],
      "question_format": "written",
      "specification_version": "1PH0",
      "mathematical_demand": false,
      "practical_demand": true,
      "flags": []
    }
  ],
  "skipped": [{ "label": "4(a)", "marks": 2, "reason": "answer is read off Figure 7" }]
}
```

`skipped` is there so the marks still reconcile. Nothing is loaded from it.
