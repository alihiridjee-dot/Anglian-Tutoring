#!/usr/bin/env python3
"""Prepare INSERT statements to load science-checked (signed) notes into Supabase
through the Supabase MCP (no service role key needed).

Usage:  python3 scripts/notes/handover/make_load_sql.py <ids_in_db.txt> <out_dir>

  ids_in_db.txt  concept ids already in public.notes, whitespace separated. Get them with
                 select string_agg(concept_id,' ' order by concept_id) from public.notes;
  out_dir        gets <id>.sql (one `insert ... on conflict (concept_id) do nothing;` each)
                 and manifest.tsv (id, expected md5 of body::text, character length).

Only notes with meta.checked_by are written, and only if their id is not already in the
database, so a note someone else published is never overwritten. After inserting a note,
run: select md5(body::text) from public.notes where concept_id='<id>' and compare it with
manifest.tsv. A mismatch means the body was altered in transcription: fix with an UPDATE
from the .sql file, never leave it.
"""
import glob, hashlib, json, os, sys

ids_file, out = sys.argv[1], sys.argv[2]
indb = set(open(ids_file).read().split())
os.makedirs(out, exist_ok=True)

def jt(v):  # Postgres jsonb::text rendering, so md5 matches md5(body::text)
    if isinstance(v, dict):
        items = sorted(v.items(), key=lambda kv: (len(kv[0].encode()), kv[0].encode()))
        return '{' + ', '.join(json.dumps(k, ensure_ascii=False) + ': ' + jt(x) for k, x in items) + '}'
    if isinstance(v, list):
        return '[' + ', '.join(jt(x) for x in v) + ']'
    return json.dumps(v, ensure_ascii=False)

rows = []
for f in sorted(glob.glob('scripts/notes/drafts/*/*.json')):
    d = json.load(open(f))
    cid = d['concept_id']
    if not d['meta'].get('checked_by') or cid in indb:
        continue
    d['meta']['status'] = 'approved'
    j = json.dumps(d, ensure_ascii=False, separators=(',', ':'))
    assert '$note$' not in j
    wb = d['meta']['written_by'].replace("'", "''")
    sql = (f"insert into public.notes (concept_id, body, format, status, written_by, approved_at, updated_at) "
           f"values ('{cid}', $note${j}$note$::jsonb, 1, 'approved', '{wb}', now(), now()) "
           f"on conflict (concept_id) do nothing;")
    open(f'{out}/{cid}.sql', 'w').write(sql)
    rows.append((cid, hashlib.md5(jt(d).encode()).hexdigest(), len(sql)))
open(f'{out}/manifest.tsv', 'w').write('\n'.join('\t'.join(map(str, r)) for r in rows))
print(len(rows), 'notes prepared:', ' '.join(r[0] for r in rows))
