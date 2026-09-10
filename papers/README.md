# Exam papers

Working area for building the exemplar library. Everything here is gitignored:
these are exam board copyright, held locally to extract questions from. The rows
themselves live in `exam_exemplars`, behind tutor-only RLS.

## How a paper gets in

Drop the question paper and its mark scheme into a Claude Code session and ask
for them to be read. Everything after that happens in the session — no API key,
no per-paper cost.

1. **Identify the pair.** Every board prints its specification code on the page:
   `1PH0/1F` is Edexcel Physics GCSE paper 1, Foundation. That is where the
   board, subject, qualification, paper and tier come from, and it is checked on
   both documents before anything is read. Filenames are ignored — a question
   paper read against another subject's mark scheme still produces rows, and
   they are silently wrong.
2. **Get the text.** `python3 scripts/ingest-paper/split_paper.py QP.pdf MS.pdf --text`
   strips the DRAFT watermark and the layout padding. When a question is
   ambiguous in the text, look at that page of the PDF directly.
3. **Write the rows** to `papers/<board>-<subject>-<level>-<year>-<sitting>-p<paper><tier>.json`,
   following [READING.md](../scripts/ingest-paper/READING.md). The filename is
   where the loader reads provenance from, so it has to match what step 1 found.
4. **Load them.** Preview, then write. Upserts, so re-reading a paper corrects
   its rows rather than duplicating them.

       bun run scripts/ingest-paper/load-exemplars.ts papers/*.json
       bun run scripts/ingest-paper/load-exemplars.ts papers/*.json --write

   Once a paper's rows are in, its two PDFs and its JSON move to `done/`. So
   what is left in `incoming/` and `named/` is what is left to read, and the
   next `papers/*.json` will not reload everything again. `--keep` opts out.

5. **Tag them** with the specification points they credit. Until that happens a
   row can only be retrieved as a style example, so generation for a particular
   point will not find it.

Expect two or three papers in a session. A paper and its mark scheme are around
15,000 words of text, and the rows written back are about as long again.

## Approval

Automatic, and decided by the database. A row is approved when it is complete:
text, marks, its own mark scheme, no flags, no missing figure. Anything short of
that is held back, and a later read that mends it approves it. Nothing else sets
or clears `approved_at`.

## The folders

    incoming/     put papers here — any name, any board
    named/        papers named after what they are
    *.json        rows waiting to be loaded
    done/         read, loaded, and out of the way
    superseded/   the old parser's output, kept but not to be loaded

One physical set of folders, in the main checkout's `papers/`
(`~/code/Anglian-Tutoring/papers/`). A worktree should link to those rather
than keep its own, so it does not matter which one you are working in — there
is only ever one copy of a paper.

`superseded/` holds the 15 JSON files the old parser produced. They are the
rows that arrive with no mark scheme, and loading them would put 460 unusable
rows back. Kept only as a record of what was tried.

`split_paper.py` without `--text` is a free look at what a paper contains — its
rows are not worth loading, because it cannot split a mark scheme across a
question's parts.

`rename_papers.py` is not part of the workflow above, but it is free and still
useful for one thing: pointed at a folder of hundreds of downloads called
`June 2019 MS-4.pdf`, it opens each one, reads the specification code and pairs
them up.

    python3 scripts/ingest-paper/rename_papers.py papers/incoming
    python3 scripts/ingest-paper/rename_papers.py papers/incoming --apply
