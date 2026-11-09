# GCSE past-paper questions: deep audit, 8 Nov 2026

Every GCSE, Trilogy and IGCSE question in `exam_exemplars` was checked: 20,269 rows from 628 papers. 19,826 of them were approved, so the question writer and the notes could use them. The audit itself changed nothing in the database. The repairs that followed are at the end: A (394 rows fixed), B (47 rows held) and C (1 note fixed). Row lists and scripts are in `papers/triage/gcse-deep-audit-2026-11-08/`.

## The short answer

The library is in good shape. The 2 Nov hold and re-read caught the big problems. This audit found no new large group of wrong text.

It did find six smaller groups of real faults, about 600 rows in all. Most can be fixed without re-reading a paper. One group can only be found by reading each question for meaning: questions that can't be answered without their picture.

## How it was checked

1. **Every row against its own PDF.** Each paper was re-read with today's extractor (the one in main since PR #344). Each live row was held to it with `check_rows.py`. The audit also added checks that tool can't make:
   - Numbers are compared with their decimal points, signs and powers. The old check ignored punctuation, so "0.99" matched "099".
   - Words printed in the part's own prompt but missing from the row.
   - Words in the part's own mark-scheme entry but missing from the row.
   - Options, option letters and AO codes are compared with the page.
   - Each row is compared with the file it was loaded from.
2. **Database checks over every row.** These cover answer keys, option shape, marks, figure and table references, page furniture, notation, tags, duplicates and AO codes.
3. **Samples read by eye**, to see which flags are real:
   - 8–12 rows from each main flag type;
   - 40 random "at-risk" rows read for meaning;
   - 30 random rows checked for tags;
   - 5 rows from a scanned paper checked against the page image.

## What is wrong (real, confirmed in samples)

**1. Powers of ten printed flat: about 100 approved rows.** For example, "1.20 × 1021 molecules" where the paper prints 10²¹, or "(x 107)" where it prints 10⁷. These rows were read from flat text in September. The app's notation formatter fixes "× 10–4". It can't fix "× 1021", because that could be a real number. So the writer and the notes see a wrong value. About 1 in 5 on the list is a false alarm, such as "× 106" used as the molar mass of Na₂CO₃. File: `flat-powers-of-ten.tsv` (108 candidates). Fix: copy the power back from today's extraction of the page, which restores superscripts.

**2. Multiple-choice questions stored in the wrong shape: 131 approved rows.**
- 76 tick-box questions are stored as written questions. Their options sit inside the prompt text. A few have lost them altogether, for example "Tick one box. A B C D" where the options were drawings. File: `tickbox-without-options.tsv`.
- 55 multiple-choice questions, mostly OCR sample papers, keep the letter inside the option text ("A 2", "B 3"). So the answer "C" can't be matched to an option. The answers themselves were checked in a sample and are right. File: `option-letters-inside-text.tsv`.

**3. Questions that can't be answered from their text: an estimated 250 approved rows.** In a random sample of 40 rows that mention a figure, graph, table or a stem they don't carry, 2 could not be answered without the missing piece. One needed a thermometer reading from a picture. The other needed the answer to the part before. That rate across the 4,850 at-risk rows gives roughly 250 (somewhere between 50 and 800). A pattern search found 83 that say so outright ("use your answer to (b)(ii)", "the food chain you gave in 03.1"). Files: `answer-depends-on-another-part.tsv` (83) and `meaning-check-candidates.tsv` (4,850 to read). Only a reading pass can find the rest.

**4. Two papers are scans: 76 approved rows that no tool can check.** These are `aqa-chemistry-gcse-2018-jun-p2F` and `edexcel-physics-igcse-2019-jun-p1P`. They have no text layer and were typed from page images on 1 Oct. Five rows were checked against the page image and all were word for word. File: `scanned-papers-unverifiable.tsv`.

**5. 15 live revision notes quote a past-paper row that has since been replaced.** The 3 Nov audit found those rows reworded or composed, and the re-read replaced them. The notes rephrase the question anyway, so the risk is small. Even so, each worked example should point at the re-read row and be checked against it. File: `notes-quoting-held-rows.tsv`.

**6. Board boilerplate inside 210 mark schemes.** In 174 OCR multiple-choice schemes it reads "For answers to Section A if an answer box is blank ALLOW correct indication…". In 36 others it reads "Please refer to the marking instructions on page 4…". It is harmless, but it is noise in every example the writer sees. File: `boilerplate-in-scheme.tsv`.

## What is fine

- **No part is loaded twice in one paper.** The same question appears in two papers only where the board set it on both the Foundation and Higher paper: 1,330 rows, as printed. Apart from that, only 4 questions are reused across years.
- **The AQA labels are all in "01.2" form now,** and the 78 rows still "held 3 Nov" all carry the superseded flag. Both handover items are done.
- **AO codes:** the "WS 3.2 read as AO3.2" bug affects no GCSE row. AQA's 2019 physics schemes really do print strands ("AO1/1"), so "AO1.1" there is correct.
- **Tags:** 28 of 30 random rows are tagged to the right point. One trilogy question on potable water is tagged "waste water treatment", and one fertiliser question is doubtful. 72 approved rows are untagged, mostly method and safety parts, which is the brief's own rule.
- **Most strict flags are tool noise, not errors.** 1,516 approved rows trip at least one strict check. In the samples, nearly all were board boilerplate, scheme text split at a page break, tables laid out again, a board typo the reader corrected ("effervescense"), or the extractor missing a part. Examples:
  - "scheme text not in the mark scheme": 0 of 8 real;
  - "scheme text from another part": 0 of 8;
  - "question text not on the paper": 0 of 6 that change the meaning;
  - "label not on the paper": almost all in 4 papers the extractor half-reads.

## Gaps in the data, not errors (low value)

- 849 approved Edexcel GCSE rows have no AO. The extractor doesn't read Edexcel's AO column.
- About 120 OCR rows drop the a/b strand (AO3.2 for AO3.2b).
- 653 rows have no command word, though the prompt has one.
- 883 options are stored as plain strings. These are mostly AQA word boxes, which still work.
- Old rows read in September write chemistry and units flat (Cl2, cm3). The app's formatter puts these right before the writer sees them, so they don't need fixing.

## Tool notes

- PR #347 (open, another session) fixes scheme text after page breaks and in tall AQA cells. That is the cause of most "scheme text from another part" flags here, so this audit doesn't duplicate it.
- The extractor can't read the scheme marks on the old-format AQA 2018 papers. Those 8 papers don't reconcile, so their rows have only half a check.
- The OCR GCSE sample paper 1 (physics) reads only 21 of its parts.

## Repairs done (option A, 8–9 Nov)

Ali chose A. 394 live rows were repaired, and all of them are still approved. Each repair was confirmed on the page first, and each row was re-read before it was written. The same edits went into the `papers/done` files, so a reload can't undo them.

- **Powers of ten: 72 rows.** The flat power was replaced with the page's own superscript, for example "1.20 × 1021" became "1.20 × 10²¹". Where the page prints both 10⁷ and 10⁻⁷, the number in front decided which one. 11 rows were rightly left alone, because the page doesn't print a power there: "1030 kg/m³" is a density, "1010 J/kg °C" a heat capacity, "RbOH = 102" a formula mass.
- **Option letters: 55 rows.** "A 2" became letter A, text "2". 51 were checked against the page's text. The 4 from the scanned Edexcel IGCSE 2019 1P paper were checked against the page image and the scheme's own "A is incorrect because…" lines.
- **Tick-box questions: 55 rows** are now multiple choice. The options came out of the prompt, and each matches the page's options and the scheme's answer. 21 rows were left as written questions on purpose:
  - some ask for a tick and an explanation ("Yes / No. Explain your answer");
  - some have options that are table rows the question already holds ("A B C D");
  - in some the page lays the options out as a table the extractor can't split.
- **Boilerplate: 212 rows.** OCR's "if an answer box is blank…" line and the "refer to the marking instructions on page 4" line were removed, and nothing else. That includes 2 rows the PR #347 session released overnight.

Checks after the write:
- every repaired row re-read live matches its plan, and none lost approval;
- the approved total is 19,838, which is 19,826 plus the 12 the other session released;
- `check_rows` on the repaired rows cleared 224 flags, including 38 "answer names no option", and added none.

**To undo:** run `bun --env-file=.env papers/triage/gcse-deep-audit-2026-11-08/scripts/apply_repairs.ts papers/backups/gcse-mechanical-repairs-2026-11-08/plan.json --undo --write`. Do the same for `plan2.json` and `plan3.json`. The original rows and files are in the same backup folder.

## Reading pass done (option B, 9 Nov)

Ali said go. 47 approved rows are now held because a student can't answer them from their own text. That is far fewer than the 250 estimated above. The estimate came from 2 rows in a sample of 40. The full read found under 1%.

How it was done:
- **First read.** 10 readers (Claude Code subagents, no API cost) read all 4,915 at-risk rows: the 4,850 listed above, plus 65 more found by the "use your answer to" search. Each row got one verdict. They held 44 and were unsure about 7.
- **Their holds, checked.** I read all 51. I overturned 5, because the text did hold what was needed: a Punnett square that prints both parents' gametes, a table to compute a mean from, "resistance varies with temperature" naming a thermistor, and a chromatogram question that is general knowledge. I held 1 of the unsure rows and kept the other 6.
- **Their keeps, checked.** 12 random kept rows that mention a figure were all rightly kept. Of 23 kept calculations that say "use your answer to…", 3 lacked a number they need, so I held them.
- **A number check over every kept row.** It flagged 227 rows whose scheme calculates with a number the question never prints. Two more readers decided, for each one, whether the number can be worked out from the text or must come from a figure or another part. They held 4 more, and I agree with all 4.

What was held:
- **12 need their figure.** For example, reading a graph that isn't there, or a wave speed whose wavelength is only on the figure. These get `needs_image` and the loader's "needs image" flag.
- **21 need another part's answer.** For example, "use your answer to 03.2" when no fallback value is given.
- **13 need a stem they don't carry.** For example, "suggest two variables to control in this investigation" when the investigation isn't described.
- **1 other.** "Complete the nuclear equation", where the equation isn't shown.

Each held row carries a flag that starts "held 9 Nov 2026: reading pass:" and says what is missing. The same flags went into the `papers/done` files, so a reload can't undo them.

Checks after the write:
- all 47 re-read live match the plan, and all 47 are held;
- the approved total is now 19,791;
- no live note quotes any of them.

**Files:** verdicts, the second check and the plan are in `papers/triage/gcse-deep-audit-2026-11-08/reading-pass/`.

**To undo:** run `apply_repairs.ts papers/backups/gcse-reading-pass-holds-2026-11-09/plan.json --undo --write`. Then copy the files in that folder's `done-files/` back to `papers/done/`.

## The 15 notes (option C, 9 Nov)

These could not be re-pointed, because there is nothing to point them to:
- **3 point at approved rows again.** The PR #347 session released those rows on 8 Nov.
- **12 point at parts the re-read deliberately left out,** because those parts need their figure. They have no replacement row.

The link is only a record of where each example came from. Students see the note's own question and answer. So I checked each of the 12 worked examples against the printed page and its mark scheme instead:
- **11 are right.** They restate the figure's facts in words, such as the food chain's biomasses and the compass equipment. Each was checked against the page image.
- **1 was wrong.** bio-016 (sterile agar plate) listed "disinfectant" as equipment the paper shows, and left out the bottle of bacteria. Figure 5 shows a Bunsen burner, an inoculating loop, an empty Petri dish, a bottle of agar and a bottle of bacteria. This is now fixed live and in `scripts/notes/drafts/biology/bio-016.json`. The draft passes `validate.ts` and matches live, apart from its status.

## Ways to fix it

**A. Mechanical repairs, no reading (recommended first).** These are live database writes, so they need a yes:
- put the powers of ten back from the page (about 100 rows);
- split the letters out of 55 options;
- turn the 76 tick-box rows into multiple-choice rows, or hold the ones whose options were pictures;
- cut the boilerplate from 210 schemes.

Each fix would be checked against the page before it is written, with a backup first.

**B. A reading pass for meaning.** Claude Code subagents read the 4,850 at-risk rows as text. They hold any row a student couldn't answer from what it holds. This costs no API money. It is about 8 readers and roughly 1.5–2 million tokens. Expect about 250 rows held.

**C. Re-point the 15 notes** at their re-read rows, and check each worked example.

**D. Leave the metadata gaps.** They don't change what a student sees.

## Files

All files are in `papers/triage/gcse-deep-audit-2026-11-08/`:
- `all-findings.tsv` lists every flag on every row.
- `findings.json` and `papers.json` hold the same results, including per-paper reconciliation.
- One TSV per fault group, named above.
- `meaning-sample-40.json` holds the 40 rows read for meaning.
- `scripts/` holds the checks:
  - `deep_check.py`: rows against the PDFs;
  - `db_checks.ts`: database checks;
  - `targeted.ts`: notation and option-shape checks, run through the app's own formatter;
  - `agg.py`: merges the results;
  - `show.py`: prints a sample of one flag type with the page's own text.

To re-run, dump the rows again with `scripts/dump.ts` (service key from the main `.env`), then run the scripts in that order.
