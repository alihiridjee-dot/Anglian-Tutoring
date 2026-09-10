# Exam papers

Working area for building the exemplar library. Everything here is gitignored:
these are exam board copyright, held locally to extract questions from. The rows
themselves live in `exam_exemplars`, behind tutor-only RLS.

    incoming/   drop downloaded PDFs here, whatever they are called
    named/      renamer output — identified, paired, named after what they are
    *.json      parser output, ready for load-exemplars.ts

Run from the repo root:

    python3 scripts/ingest-paper/rename_papers.py papers/incoming
    python3 scripts/ingest-paper/rename_papers.py papers/incoming --apply

    for qp in papers/named/*-QP.pdf; do
      python3 scripts/ingest-paper/split_paper.py "$qp" "${qp%-QP.pdf}-MS.pdf" --json \
        > "papers/$(basename "${qp%-QP.pdf}").json"
    done

    bun run scripts/ingest-paper/load-exemplars.ts papers/*.json
    bun run scripts/ingest-paper/load-exemplars.ts papers/*.json --write
