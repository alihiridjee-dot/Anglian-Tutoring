# Science checker instructions (Anglian Tutoring revision notes)

Repo: /home/user/Anglian-Tutoring. Follow scripts/notes/CHECK_BRIEF.md exactly (read it, plus scripts/notes/WRITING_GUIDE.md and src/lib/notes/noteFormat.ts). You check and fix the notes you are given in scripts/notes/drafts/<subject>/<id>.json against their source packs scripts/notes/.sources/<id>.json (hand-built; may be a subset of the questions; do not modify them; "OCR sample null" source strings are expected).
Confirm any worked example against the full database record by exemplar id using READ-ONLY SELECTs via the Supabase MCP (ToolSearch `select:mcp__Supabase__execute_sql`, fallback `mcp__org-connector-supabase__execute_sql`; project id peohauhwquuvghrpmotf; never write to the database). The validator only accepts a worked example whose exemplar is in the concept's own pack, so do not swap in a question that is not in the pack.

Check everything in CHECK_BRIEF.md, and specifically:
- Every statement is correct at GCSE level; every equation in its own equation box with units; sub/superscripts proper; Higher tier labelled "(Higher tier)" and separate-science "(Separate science)" per the concept data (higher_only / separate_only in scripts/notes/concepts/gcse-<subject>.json) and spec; no board names in shared text.
- Every worked-example question matches the pack/database for its exemplar_id (figure or table data inlined faithfully, nothing added that changes the question), answer_points follow that mark scheme, no paper/year/board visible to students (only the `source` field).
- Exam phrases come from mark schemes (not answers/equations); EVERY mistake must be backed by a mark scheme or its ignore/reject/do-not-accept rule: verify or cut/reword. Do not leave invented ones.
- Interactives (practice, slider, predictor, sort, sequence, explorer, compare, flow, line-graph, scenes): work them through at BOTH ends of every range; formulas, units, decimals, no rounding ties, realistic values, scene colours valid per SCENE_COLOURS.
- All spec points of the concept covered for every board that has a layer; add what is missing in the same light style; cut rather than guess if something cannot be made right.
- Writers' flags (below, in your task) deserve extra scrutiny.

Fix in place. Sign each note you have fully checked: meta.checked_by = "sonnet-science-check", meta.checked_at = "2026-10-01". Validate with `bun run scripts/notes/validate.ts <subject> --ids <your ids>` and fix until it passes.
Do not touch other notes, run git, or write to the database. Report: notes signed, one line per note on changes, any note you could not sign and why.
