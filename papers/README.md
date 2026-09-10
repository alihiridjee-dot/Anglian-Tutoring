# Exam papers

Working area for building the exemplar library. Everything here is gitignored:
these are exam board copyright, held locally to extract questions from. The rows
themselves live in `exam_exemplars`, behind tutor-only RLS.

    incoming/   drop downloaded PDFs here, whatever they are called
    named/      renamer output — identified, paired, named after what they are
    *.json      extracted rows, ready for load-exemplars.ts

Papers are read inside a Claude Code session. No API key, no per-paper cost —
the reading happens in the session you are already paying for. Run these from
the repo root.

**1. Name and pair them.** Papers download as `June 2019 MS-4.pdf`. This reads
each one to find its specification code and names it after what it actually is.
A file it cannot identify is left alone rather than guessed at.

    python3 scripts/ingest-paper/rename_papers.py papers/incoming
    python3 scripts/ingest-paper/rename_papers.py papers/incoming --apply

**2. Ask Claude Code to read a paper.** Point it at a pair in `papers/named/`.
It gets the text with

    python3 scripts/ingest-paper/split_paper.py QP.pdf MS.pdf --text

reads both documents, and writes `papers/<stem>.json` — one row per answerable
part, each with its own mark scheme. The rules it follows are in
`scripts/ingest-paper/READING.md`, including the one that matters most: it
transcribes and never composes. A question it cannot read faithfully is flagged
with the reason, not filled in.

`split_paper.py` on its own (no `--text`) is still the quickest free look at
what a paper contains. It cannot split a mark scheme across a question's parts,
so its rows mostly arrive without one and stay unapproved.

**3. Load them.** Preview first. `--write` upserts, so re-reading a paper
corrects its rows in place rather than duplicating them.

    bun run scripts/ingest-paper/load-exemplars.ts papers/*.json
    bun run scripts/ingest-paper/load-exemplars.ts papers/*.json --write

**4. File them under the specification.** Until a row is tagged with the spec
points it credits, generation for a specific point cannot find it — it can only
ever turn up as a style example. Ask Claude Code to tag a course's rows in the
same way it read the papers.

## Approval

Automatic, and decided by the database. A row is approved when it is complete:
text, marks, its own mark scheme, no flags, no missing figure. Anything short of
that is held back, and a later ingest that mends it approves it. Nothing else
sets or clears `approved_at`.

Two scripts here do the reading and tagging through the paid API instead —
`read-paper.ts` and `tag-exemplars.ts`, roughly 45p a paper. They are not part
of this workflow and cost real money; use them only deliberately.
