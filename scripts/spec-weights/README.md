# Spec point weights

Offline sizing of spec points, so the planner can divide a topic into weeks by
**workload** rather than by counting points.

## The problem this solves

`allocateWeeks` sizes a topic's band by `pointCount` and `splitAcrossWeeks` cuts
it into equal *counts* — both assume spec points are interchangeable units. On a
real spec they are not: "know the word equation for anaerobic respiration" and
"investigate how enzyme activity is affected by pH" are one point each.

## The programme this is measured against

One year: **the first Monday of September to the average exam period** (the
midpoint of the summer series, ~28 May — not the first paper). That is **37
weeks**, and with a 3-week revision run, **34 teaching weeks**. Stable year to
year. `compare_split.py` computes it rather than hard-coding it.

Note that `examMondayFor()` in `src/lib/planner/pacing.ts` currently anchors on
the first Monday on or after 1 June, which is 39 weeks out — about two weeks
*after* the average exam date, and after many students have sat paper 1.

## What a weight is

A number in *study units*: the relative teaching-and-learning load of one spec
point. Only ratios matter — the planner uses them to divide a fixed number of
weeks, so a tree that is uniformly 20% high still produces the same plan.

They are **not** calibrated to clock time. Converting units to minutes would need
a guided-learning-hours figure for the qualification, and none of these spec PDFs
states one.

## Running it

Requires `pypdf`. This is a one-off offline pipeline, not app code — it runs once
per spec, and the output is reviewed by a tutor before being loaded into
`spec_points.weight`.

```bash
python3 scripts/spec-weights/score_aqa_gcse_biology.py \
  --pdf ~/Downloads/AQA-8461-SP-2016.PDF \
  --points scripts/spec-weights/out/aqa-gcse-biology-points.json

python3 scripts/spec-weights/score_by_code.py --board ocr \
  --pdf "~/Downloads/OCR biology spec.pdf" \
  --points scripts/spec-weights/out/ocr-gcse-biology-points.json

python3 scripts/spec-weights/score_by_code.py --board igcse \
  --pdf ~/Downloads/international-gcse-biology-2017-specification1.pdf \
  --points scripts/spec-weights/out/edexcel-igcse-biology-points.json

python3 scripts/spec-weights/compare_split.py   # before/after, every tree in out/
```

## Two shapes of spec

**Code-matched** (`score_by_code.py`) — OCR J247 and Edexcel iGCSE 4BI1 number
every learning outcome and our tree uses the same numbering, so each statement is
found by its code. OCR 138/138 (129 statements + 9 practical activity groups),
iGCSE 176/176.

**Section-matched** (`score_aqa_gcse_biology.py`) — AQA's 97 leaf sections do not
line up with our 92 points: the tree merges AQA's four pathogen sections into
one point and splits AQA's one digestive-system section into four. `align()`
walks both in spec order and allows either. Where a section is split across *k*
points each gets `score / k`, so a topic's total is conserved wherever the
boundaries fall.

## How a point gets its weight

| Signal | Effect |
| --- | --- |
| Command verb (state/know → evaluate/investigate) | 1.0 → 2.2 |
| The statement *is* a practical | +2.0 |
| Each additional "students should be able to…" (AQA) | +0.35 |
| Each bulleted item of content | +0.22 |
| Maths (MS/M) and apparatus (AT) skill tags | +0.25 / +0.15 each, capped |
| Higher tier only | +0.3 |
| Residual word count | up to +1.6 |

Scope markers are deliberately **not** scored: AQA's "(biology only)", Edexcel's
`B` suffix and OCR's  glyph all mean "separate science, not combined", which
says nothing about how long the content takes.

## Loading them

```bash
bun run scripts/spec-weights/load-weights.ts          # dry run
bun run scripts/spec-weights/load-weights.ts --write
```

Idempotent, and it refuses to write if any CSV code has no matching row. The
CSVs are the source of truth: regenerate, review, load.

## What reads them

- `spec_points.weight` (migration `20260803094500_spec_point_weight.sql`),
  default 1 — an unweighted tree behaves exactly as it did before.
- `allocateWeeks` in `src/lib/planner/pacing.ts` sizes each topic's band by the
  sum of its points' weights instead of counting rows.
- `splitAcrossWeeks` cuts a topic into weeks of equal *work* (exact min-max
  partition, ties broken to level the lightest week up), instead of equal counts
  rounded up.
- `selectWeekPoints` budgets the teach lane by this week's weight rather than
  `chunks[0].length`, so the roadmap and the weekly plan agree on a week's size.

## Result

At 34 teaching weeks, heaviest week ÷ lightest week:

| Tree | Points | Before | After |
| --- | --- | --- | --- |
| AQA GCSE | 92 | 11.8x | 1.8x |
| Edexcel GCSE | 165 | 4.7x | 1.6x |
| Edexcel iGCSE | 176 | 3.1x (2 empty weeks) | 1.8x |
| OCR GCSE | 138 | 4.0x | 1.7x |

"After" is measured by running the shipped `computePacing` + `withWeeklyPoints`
against the live weights, not by a model of them.

## Caveats

- **AQA: 56 of 92 points matched a single section cleanly**; the other 36 merge
  or split. Merges are generally right; a few split boundaries are approximate,
  so two adjacent points may share a correct total while the division between
  them is a guess. Topic totals are unaffected.
- **OCR higher tier is not detected.** OCR marks HT-only statements in bold type,
  which plain-text extraction cannot see. Every other board's HT marker is
  textual and is picked up.
- **Re-check the parse when a spec is reissued.** The AQA parser stops at "4.8
  Key ideas"; an earlier version stopped too late and the final section absorbed
  the appendix that re-lists all ten required practicals, scoring "Role of
  biotechnology" as if it contained every practical in the course. Both scripts
  now report how many statements they found — if that number moves, look at why.
- The weights are a starting point for tutor review, not an authority.
