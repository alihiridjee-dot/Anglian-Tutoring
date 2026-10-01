# Loader agent prompt (copy, fill in the ids, spawn one per ~10 notes)

Job: load already-approved revision notes into the Supabase database, exactly as prepared, one note per call. Project id peohauhwquuvghrpmotf. Use the Supabase MCP execute_sql tool (ToolSearch `select:mcp__Supabase__execute_sql`). The user has authorised these inserts.

Prepared SQL is in <OUT_DIR>/<concept id>.sql (made by make_load_sql.py). Expected checksum of what the database should hold is in <OUT_DIR>/manifest.tsv (id, md5, character length).

Your concept ids, in order: <IDS>

For each id:
1. Print the file with Bash `cat` (not Read: it truncates long lines).
2. Call execute_sql with the statement copied EXACTLY, character for character. Do not reformat, paraphrase, escape or alter anything, and do not add or remove any key, word or punctuation (loaders have twice altered a note; the checksum caught both). Append: `select concept_id, md5(body::text) h, status from public.notes where concept_id='<id>';`
3. Compare h with manifest.tsv. If not equal, or on error: do not retry, do not modify the database any other way; record it and move on.
Run no other SQL. No DELETE/UPDATE/DROP. No git. Report ids verified and any mismatch.
