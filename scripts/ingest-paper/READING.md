# Reading an exam paper

Instructions for whoever — person or model — turns a question paper and its mark
scheme into rows. Written for a Claude Code session: no API key, no per-paper
cost, the reading happens in the session.

**Check the two documents are the same paper first.** Every board prints its
specification code on the page — `1PH0/1F`, `J247/01`, `8463/1H`, `8464/B/1F`,
`0625/42`, `9203/1` — and it must match on both. Filenames lie: a question paper read against another subject's
mark scheme still produces rows, and nothing downstream will notice. That code
is also where the board, subject, qualification, paper and tier come from, so
name the output file after it.

Then get the text. This strips the DRAFT watermark and trims the layout padding
that would otherwise be most of what you read:

    python3 scripts/ingest-paper/split_paper.py QP.pdf MS.pdf --text

Read the text. Where a question is ambiguous — a table that came out scrambled,
an option that may be part of a figure — look at that page of the PDF itself.

Write the result to `papers/<board>-<subject>-<level>-<year>-<sitting>-p<paper><tier>.json`
in the shape at the bottom, then load it with `load-exemplars.ts`. The loader
takes provenance from that filename, so it has to match the specification code.
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

## Tagging is part of reading, not a later pass

An untagged question grounds a generated question by style only — same board,
same subject, any topic. A tagged one grounds it by the spec point itself, which
is the whole value of the library. You are already reading the question, so
decide then: put the codes in `spec_points` on the row and `load-exemplars.ts`
writes the links with everything else.

The point is what the question *credits*: a calculation set in a photosynthesis
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

## The rule that matters

**Transcribe. Never compose.** Every word of a prompt, an option and a mark
scheme must appear in the documents in front of you. Do not reword, modernise,
summarise, complete or correct anything — not even when the source is obviously
mangled by PDF extraction.

If you cannot represent a question faithfully, flag it and say what is missing.
That is the correct outcome and costs nothing. There are hundreds of questions
and binning a broken one is free.

Filling the gap is the one unrecoverable mistake, for two reasons. A question
whose four options live inside a figure would get four invented options, and the
mark scheme still says the answer is B — so that row would mark a child's answer
against the wrong thing. And generation copies these rows for style, so a
fabricated exemplar teaches it to imitate model output rather than the board,
which is the exact failure the library exists to prevent.

## Rows

One row per answerable part. A question with parts (a), (b)(i), (b)(ii) is three
rows; a question with no parts is one row.

- **label** — exactly as the paper prints it: `7`, `7(a)`, `7(b)(ii)`, `04.3`.
- **q** — the question number alone: `7`.
- **shared_context** — the stem the parts share: the scenario, the data table,
  the extract. Verbatim, and attached to every part that needs it. A part's
  prompt must never depend on text left behind.
- **prompt** — this part's own question text, verbatim, without the shared stem
  and without the printed marks. Leave out what the candidate writes into:
  dotted answer lines, ruled space, "Your answer", answer boxes.
- **options** — multiple-choice options as printed. Null unless the paper prints
  them. Never write options yourself.
- **marks** — the allocation printed for this part.
- **mark_scheme** — this part's own answer and marking guidance, verbatim,
  including accept/allow/ignore notes and any error-carried-forward rule. Not
  the whole question's scheme, and not a sibling part's.
- **needs_image** — true when answering needs a figure, graph, diagram or
  photograph that is not in the text. Extraction drops images, so this is common
  and is not a failure. Around 40% of rows.
- **command_word** — Describe, Explain, Calculate, State, Evaluate, Suggest,
  Compare. Null if there is none.
- **assessment_objectives** — only if the mark scheme prints them. Extraction
  breaks them apart, so normalise: `AO 2 1`, `AO2 1` and `AO2.1` are all
  `["AO2.1"]`. Empty array if the scheme does not print them.
- **question_format** — `mcq` when options are printed, otherwise `written`.
- **specification_version** — the specification code the paper was set against,
  as printed: `1PH0`, `J247`, `8463`. It does not narrow retrieval yet, because
  no topic records one, but it is what tells a 2016-spec question from a
  reformed one later.
- **mathematical_demand** / **practical_demand** — whether answering requires
  calculation, and whether it draws on practical technique. Judgements about the
  question, and both can be true.
- **spec_points** — the specification points this part credits, as codes without
  the board prefix: `["1.6", "6.4"]`. See "Tagging is part of reading" above.
  Omit it rather than guess.
- **flags** — empty when the row is complete and faithful. Otherwise say what is
  wrong: the options are in a figure, the text is garbled, the mark scheme does
  not cover this part. A flagged row is never approved, so this is the brake.

Skip everything that is not a question: cover pages, instructions to candidates,
formula sheets, periodic tables, blank pages, "Turn over", page footers.

## Un-interleaving a mark scheme

Mark schemes are printed as a table — the creditworthy answer in one column, the
examiner's guidance in another — and extraction weaves the two together line by
line, so a sentence of the answer is cut in half by a note about it.

Put the columns back: the answer as continuous text, then the guidance after a
line reading `Guidance:`. Keep both. This is the only reordering allowed.

Before:

> substitution (1) (3) (F =) 0.10 x 2.0 AO 2 1 100 x 2 (using 0.10kg = 100g)
> reject 0.10 x 2.02 and the follow up evaluation

After:

> substitution (1) (F =) 0.10 x 2.0 · evaluation (1) 0.2(0) · unit (1) N
> Guidance: reject 0.10 x 2.02 and the follow-up evaluation; correct answer
> without working gets 2 marks

## Checking the work

Index the paper before transcribing it: list every question, its parts, and the
marks printed for it. Then check the rows against that index.

- Every question in the index has rows. A question that quietly vanished is the
  failure worth catching, because nothing else will show it.
- Each question's part marks add up to the question's total.
- The paper's marks add up to the total on the cover, where one is printed.
  Edexcel and OCR print one; AQA does not.

Both boards tested this way came out exact: 90 of 90 marks on OCR Biology 2019
paper 1, 100 of 100 on Edexcel Physics 2018 paper 1F.

## Output shape

```json
{
  "profile": "read-by-hand",
  "rows": [
    {
      "label": "4(c)",
      "q": "4",
      "shared_context": "Figure 7 shows a skier going down a hill...",
      "prompt": "Describe how her speed at the bottom of the slope could be determined.",
      "options": null,
      "marks": 3,
      "mark_scheme": "measure a distance (1)...\nGuidance: allow a light gate...",
      "needs_image": false,
      "command_word": "Describe",
      "assessment_objectives": ["AO2.2"],
      "question_format": "written",
      "specification_version": "1PH0",
      "mathematical_demand": false,
      "practical_demand": true,
      "flags": []
    }
  ],
  "scheme": []
}
```

`scheme` stays empty — it is where the old parser put whole-question schemes it
could not split, and there is nothing left to split.
