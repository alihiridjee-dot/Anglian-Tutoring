# Writer instructions (Anglian Tutoring revision notes)

Repo: /home/user/Anglian-Tutoring. You write the revision notes for the concept ids you are given. Other writers work in parallel on other concepts: touch only your own files.

## Read first, and follow exactly
- scripts/notes/GENERATION_BRIEF.md (your job), scripts/notes/WRITING_GUIDE.md, src/lib/notes/noteFormat.ts
- approved examples: scripts/notes/trial/c/biology/ and scripts/notes/trial/templates/ (interactive and scene JSON)
- two signed notes from the SAME subject in scripts/notes/drafts/<subject>/ for structure and density (pick any file whose meta has "checked_by")

## Source packs (deviation from the brief)
build-sources.ts cannot run (no service role key). Build the packs yourself with READ-ONLY SQL through the Supabase MCP: load it with ToolSearch `select:mcp__Supabase__execute_sql` (fallback `mcp__org-connector-supabase__execute_sql`), project id peohauhwquuvghrpmotf. SELECT only; never write to the database.
Reproduce scripts/notes/build-sources.ts (read it): per concept fetch spec_points (id, code, title, description), exam_exemplar_spec_points links, and exam_exemplars (id, board, year, series, paper, tier, question_label, marks, command_word, shared_context, prompt, mark_scheme, needs_image, flags, approved_at), keeping approved_at not null, mark_scheme not null, no flags; group by board ("aqa*" collapses to "aqa"), sort by marks descending, and write scripts/notes/.sources/<concept id>.json in exactly the shape the script produces (source string `${BOARD upper} ${series} ${year}, Paper ${paper}${tier ? ` (${tier})` : ""}, Q${question_label}`). Broad spec points are linked to many unrelated questions so results can be large: query a concept at a time, prefer json_agg, keep the topic-relevant questions (every 2+ mark question on topic per board, mark schemes in full: never shorten a mark scheme you quote from). If the tool saves a big result to a file, process it with python rather than retyping. Use UNIQUE scratch file names containing your concept ids, in your own subfolder of the scratchpad directory (shared scratchpad: other writers overwrote each other's scripts before). Reuse an existing .sources pack if present.
IMPORTANT: the validator only accepts a worked example whose exemplar is in that concept's own pack, so put every question you want to use into the pack file. Questions that are multiple choice often have the options missing in the pack: fetch the options from the database record and write them into the question text. Prefer 3 to 6 mark questions with a real mark scheme; avoid 1-mark questions and bare-letter multiple choice where a better one exists.

## Writing
Draft each note into scripts/notes/drafts/<subject>/<id>.json, validating with `bun run scripts/notes/validate.ts <subject> --ids <ids>` (dependencies installed) and fixing errors before moving on. Skip a concept whose draft file already exists. meta.written_by "sonnet-5-5", status "draft"; never set meta.checked_by.
There is NO Exam tips section in the app any more; the validator still requires exam_phrases and mistakes, so write them to spec from the mark schemes (never invent exam wording).

## Lessons from earlier science checks (avoid these)
- Every mistake must be backed by a mark scheme or its ignore/reject/do-not-accept rules; do not invent mistakes or exam phrases; exam phrases are wording from mark schemes, not answers or equations.
- No content beyond the spec presented as required; do not overstate mechanisms a board says are not required.
- Worked examples must stand alone: if the original cites a Figure or Table, inline the data or choose another question. Never use the same worked example in two notes.
- Practice and slider ranges must give realistic values at BOTH ends (check units, decimals, no rounding ties, no impossible formulae). Every equation goes in its own equation box with units. Proper sub/superscript notation for formulae.
- Mark Higher-tier content "(Higher tier)" and separate-science-only content "(Separate science)" according to the concept data (higher_only / separate_only in scripts/notes/concepts/gcse-<subject>.json) and the spec.
- Never mention a paper, year or board anywhere a student sees it (only the worked_example `source` field may). Board names must not appear in shared text; board-only content goes in that board's `extra`.
- If a board's pack has no usable question, give it only phrases the mark schemes support and omit the worked example; say so in your report.
- Check concept-map oddities (spec points linked to unrelated questions) and report them.

## Rules
Edit only scripts/notes/drafts/<subject>/ and scripts/notes/.sources/ files. No git. No network except the Supabase SELECTs. Do not skip a concept.
Final report: notes written, validator result, anything a reviewer should check (thin packs, derived answers, concept-map oddities).
