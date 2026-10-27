# Higher-tier markers for Edexcel and OCR GCSE spec points

AQA's spec text says "(HT only)" next to Higher-tier-only content, so the database carried
tier data for AQA from the day its points were loaded. Edexcel and OCR say it with **bold
type** instead ("text in bold indicates content that is for higher tier only"; "Statements
shown in bold type will only be tested in the Higher Tier papers"), which plain-text
extraction loses. These scripts read the bold runs out of the official PDFs with PyMuPDF and
turn them into the same marker on our descriptions, so every GCSE board is described the
same way:

- a whole Higher-tier statement ends ` (HT only)` (before the full stop, or before
  ` To include:` on OCR);
- a partly Higher-tier statement ends with a note naming the part, e.g.
  `(HT only: half equations)`, `(HT only: speed)`.

Run on 2026-10-17 against the specs in `papers/specs/` (Edexcel 1BI0, 1CH0, 1PH0; OCR
Gateway J247, J248, J249): 175 points marked (167 whole, 8 part). Backup and change log:
`papers/backups/spec-point-ht-before-2026-10-17.json`, `spec-point-ht-changes-2026-10-17.json`.

## The steps

Work in a scratch folder; every script reads and writes the current directory.

1. `python3 -I edexcel_bold.py <spec.pdf> edx_<subject>.json` — one row per statement with
   the share of its letters in bold and the bold fragments. Rows start at a code (`2.20`,
   `13.7P`, `1.13B`) in the left column; the maths-skills column and page footers are ignored.
2. `python3 -I ocr_bold.py <spec.pdf> ocr_<subject>.json` — OCR's content tables are rotated
   90°, so a row runs across the page and the columns (Learning outcomes, To include, …) are
   bands of y. Every row's code is bold exactly when the statement is, so `code_bold` is the
   tier; the bold fragments of the statement and its "To include" guidance show partial cases.
   A table that continues onto a page without its header row reuses the previous page's bands.
3. Export the Edexcel + OCR GCSE points (`id, code, title, description, updated_at` with
   `topics(board, level, subject)`) to `db_points.json`, then `python3 -I match_ht.py`. It maps
   spec codes to ours (`2.20` → `EDEX 2.20`, `C3.1e` → `OCR C3.1e`, `B1.2a` → `OCR 1.2a`),
   prints codes missing on either side, and writes `ht_found.json`.
4. `python3 -I make_plan.py` — turns the matches into exact description edits
   (`ht_changes.json`), with the eight partial cases written by hand in `PARTIAL_EDITS`.
   Header words the OCR parser sometimes sweeps up ("Topic content", "Tiering") are filtered.
5. Apply with guarded SQL (`… and description not like '%(HT only%'`), per rule: append
   ` (HT only)` (Edexcel), insert before ` To include:` or the final `.` (OCR), `replace()`
   for the partial ones. Check every rendered page you are unsure of: `pymupdf` renders a page
   to PNG in one line.

## Known gaps

- OCR Chemistry `C4.2a` and `C5.1f` (Higher tier) were missing: the July ingest skipped any
  code followed by "(Combined Science …)". Added 27 Oct 2026 (weights 1.30 / 1.70 in
  `spec-weights/out/ocr-gcse-chemistry.csv`); they have no note link, video or tagged
  past-paper question yet. Backup and undo: `papers/backups/ocr-c42a-c51f-*-2026-10-27.*`.
- The spec weights were scored before these markers existed, so no Edexcel or OCR point has the
  Higher-tier bonus yet. A re-score moves students' weekly plans, so Ali deferred it until after
  the GCSE launch (27 Oct). `score_db.ts` reads descriptions only, so AQA's title-only markers
  (about 45 titles, plus the momentum section) would still miss the bonus.
- OCR Biology's nine PAG points (`OCR 7.1`–`7.9`) are practical groups, not spec statements.
- Trilogy / Combined Science specs were not read; our AQA Trilogy points already carry
  AQA's own markers, and there are no Edexcel or OCR combined courses in the database.
