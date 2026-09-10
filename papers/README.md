# Exam papers

Working area for building the exemplar library. Everything here is gitignored:
these are exam board copyright, held locally to extract questions from. The rows
themselves live in `exam_exemplars`, behind tutor-only RLS.

    incoming/   drop downloaded PDFs here, whatever they are called
    named/      renamer output — identified, paired, named after what they are
    *.json      extracted rows, ready for load-exemplars.ts

Run from the repo root.

**1. Name and pair them.** Papers download as `June 2019 MS-4.pdf`. This reads
each one to find its specification code and names it after what it actually is.
Free, and nothing is guessed: a file it cannot identify is left alone.

    python3 scripts/ingest-paper/rename_papers.py papers/incoming
    python3 scripts/ingest-paper/rename_papers.py papers/incoming --apply

**2. Read the papers.** A model reads both documents and returns the rows.
Roughly 40-60p a paper on Sonnet, and it prints what it spent.

    bun run scripts/ingest-paper/read-paper.ts papers/named/*-QP.pdf

`split_paper.py` does the same job with regular expressions and costs nothing,
but it can only attach a whole question's mark scheme to the question's first
part, so most rows come out with no scheme of their own and cannot be used.
Keep it for a quick look at what a paper contains:

    python3 scripts/ingest-paper/split_paper.py QP.pdf MS.pdf

**3. Load them.** Preview first; `--write` upserts, so re-reading a paper
corrects its rows in place rather than duplicating them.

    bun run scripts/ingest-paper/load-exemplars.ts papers/*.json
    bun run scripts/ingest-paper/load-exemplars.ts papers/*.json --write

**4. File them under the specification.** Until this runs, a row can only ever
be retrieved as a style example — generation for a specific spec point will not
find it. A few pence per course.

    bun run scripts/ingest-paper/tag-exemplars.ts --board ocr --subject biology --level gcse
    bun run scripts/ingest-paper/tag-exemplars.ts --board ocr --subject biology --level gcse --write

Rows arrive unapproved and nothing generates or marks from them until
`approved_at` is set. Rows that need a figure, or that the model could not read
faithfully, carry the reason in `flags` and are excluded from retrieval.
