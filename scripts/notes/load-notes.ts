/**
 * Load revision notes into Supabase.
 *
 *   bun run scripts/notes/load-notes.ts biology                    # preview
 *   bun run scripts/notes/load-notes.ts biology --write            # load
 *   bun run scripts/notes/load-notes.ts chemistry --ids chem-001,chem-002 --write
 *
 * Preview by default: it prints what it would do and touches nothing.
 *
 * Every run upserts the subject's whole concept map (concepts and their spec
 * points), so the Notes page can list every topic. Then each draft in
 * scripts/notes/drafts/<subject>/ that passes the validator is upserted:
 *   - a note the science check has signed (meta.checked_by) is published
 *     ('approved') — students see it straight away;
 *   - an unchecked note is loaded as a draft that only tutors can see.
 * A note that fails validation is reported and not loaded at all.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (writes bypass RLS).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateNote, type Note } from "../../src/lib/notes/noteFormat";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");

const args = process.argv.slice(2);
const subject = args[0];
if (!["biology", "chemistry", "physics"].includes(subject))
  throw new Error("Usage: load-notes.ts <biology|chemistry|physics> [--ids a,b] [--write]");
const write = args.includes("--write");
const idsAt = args.indexOf("--ids");
const only = idsAt >= 0 ? new Set(args[idsAt + 1].split(",")) : null;

const here = dirname(fileURLToPath(import.meta.url));
type Ref = { id: string; board: string; code: string; primary: boolean };
type Concept = {
  id: string;
  group: string;
  title: string;
  scope: string;
  kind: string;
  higher_only: boolean;
  separate_only: boolean;
  spec_points: Ref[];
};
const map: { concepts: Concept[] } = JSON.parse(
  readFileSync(join(here, "concepts", `gcse-${subject}.json`), "utf8"),
);

const headers = {
  apikey: key,
  ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
  "Content-Type": "application/json",
};
async function api(path: string, init: RequestInit) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init.method} ${path} failed: ${res.status} ${await res.text()}`);
}
const upsert = (table: string, rows: unknown[], onConflict: string) =>
  api(`${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });

// 1. The concept map.
const conceptRows = map.concepts.map((c, i) => ({
  id: c.id,
  subject,
  level: "gcse",
  chapter: c.group,
  title: c.title,
  scope: c.scope,
  kind: c.kind,
  higher_only: c.higher_only,
  separate_only: c.separate_only,
  sort_order: i + 1,
}));
const linkRows = map.concepts.flatMap((c) =>
  c.spec_points.map((r) => ({ concept_id: c.id, spec_point_id: r.id, is_primary: r.primary })),
);

// 2. The notes.
const dir = join(here, "drafts", subject);
const files = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
  : [];
const publish: {
  concept_id: string;
  body: Note;
  written_by: string;
  status: string;
  approved_at: string | null;
}[] = [];
let failed = 0;
for (const f of files) {
  const id = f.replace(/\.json$/, "");
  if (only && !only.has(id)) continue;
  const note: Note = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const errs = validateNote(note);
  if (!map.concepts.some((c) => c.id === note.concept_id))
    errs.push(`concept ${note.concept_id} is not in the map`);
  if (errs.length) {
    failed++;
    console.log(
      `✗ ${id}: not loaded — ${errs[0]}${errs.length > 1 ? ` (+${errs.length - 1} more)` : ""}`,
    );
    continue;
  }
  const checked = Boolean(note.meta.checked_by);
  const body = { ...note, meta: { ...note.meta, status: checked ? "approved" : "draft" } } as Note;
  publish.push({
    concept_id: note.concept_id,
    body,
    written_by: note.meta.written_by,
    status: checked ? "approved" : "draft",
    approved_at: checked ? new Date().toISOString() : null,
  });
  console.log(`${checked ? "✓ publish" : "· draft  "} ${id} ${note.title}`);
}

const live = publish.filter((p) => p.status === "approved").length;
console.log(
  `\n${subject}: ${conceptRows.length} concepts, ${linkRows.length} spec-point links; ${live} notes to publish, ${publish.length - live} as drafts, ${failed} not loaded.`,
);

if (!write) {
  console.log("Preview only. Re-run with --write to load.");
} else {
  await upsert("note_concepts", conceptRows, "id");
  // Replace this subject's links so a re-mapped point doesn't linger in its old concept.
  await api(`note_concept_spec_points?concept_id=in.(${conceptRows.map((c) => c.id).join(",")})`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  for (let i = 0; i < linkRows.length; i += 500)
    await upsert(
      "note_concept_spec_points",
      linkRows.slice(i, i + 500),
      "concept_id,spec_point_id",
    );
  for (let i = 0; i < publish.length; i += 50)
    await upsert(
      "notes",
      publish
        .slice(i, i + 50)
        .map((p) => ({ ...p, format: 1, updated_at: new Date().toISOString() })),
      "concept_id",
    );
  console.log("Loaded.");
}
if (failed) process.exit(1);
