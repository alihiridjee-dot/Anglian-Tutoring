/**
 * Load revision notes into Supabase.
 *
 *   bun run scripts/notes/load-notes.ts biology                    # preview
 *   bun run scripts/notes/load-notes.ts biology --write            # load
 *   bun run scripts/notes/load-notes.ts chemistry --ids chem-001,chem-002 --write
 *
 * Preview by default: it prints what it would do and touches nothing.
 *
 * A run covers the subject's whole concept map (GCSE and IGCSE, merged by
 * conceptMap.ts), or only the concepts named with --ids. Links are only ever
 * added; links live but not in the files are listed and removed only with
 * --prune. The preview compares every note with the live one. Then each draft in
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
import { loadConceptMap } from "./conceptMap";

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
const map = loadConceptMap(subject);

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

// 1. The concept map. --ids limits everything to the concepts named.
const scoped = map.concepts.filter((c) => !only || only.has(c.id));
const conceptRows = scoped.map((c) => ({
  id: c.id,
  subject,
  level: c.level,
  chapter: c.group,
  title: c.title,
  scope: c.scope,
  kind: c.kind,
  higher_only: c.higher_only,
  separate_only: c.separate_only,
  sort_order: map.concepts.indexOf(c) + 1,
}));
const linkRows = scoped.flatMap((c) =>
  c.spec_points.map((r) => ({ concept_id: c.id, spec_point_id: r.id, is_primary: r.primary })),
);
// What is live now, so the preview can say what will change.
const scopedIds = scoped.map((c) => c.id);
const getRows = async (path: string) => {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { ...headers, Range: `${from}-${from + 999}`, "Range-Unit": "items" },
    });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
    const page = (await res.json()) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
};
const liveLinks = (
  (await getRows("note_concept_spec_points?select=concept_id,spec_point_id")) as {
    concept_id: string;
    spec_point_id: string;
  }[]
).filter((l) => scopedIds.includes(l.concept_id));
const want = new Set(linkRows.map((l) => `${l.concept_id}|${l.spec_point_id}`));
const have = new Set(liveLinks.map((l) => `${l.concept_id}|${l.spec_point_id}`));
const newLinks = linkRows.filter((l) => !have.has(`${l.concept_id}|${l.spec_point_id}`));
const staleLinks = liveLinks.filter((l) => !want.has(`${l.concept_id}|${l.spec_point_id}`));
const liveNotes = new Map(
  (
    (await getRows("notes?select=concept_id,body")) as { concept_id: string; body: unknown }[]
  ).map((n) => [n.concept_id, n.body]),
);
const stable = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
        )
      : v;
const sameAsLive = (n: Note) => {
  const live = liveNotes.get(n.concept_id) as Note | undefined;
  if (!live) return false;
  const strip = (x: Note) => ({ ...x, meta: { ...x.meta, status: undefined } });
  return JSON.stringify(stable(strip(n))) === JSON.stringify(stable(strip(live)));
};

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
  else if (!scopedIds.includes(note.concept_id)) continue;
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
  const state = !liveNotes.has(id) ? "NEW" : sameAsLive(note) ? "same" : "CHANGED";
  console.log(`${checked ? "✓ publish" : "· draft  "} ${id} [${state}] ${note.title}`);
}

const live = publish.filter((p) => p.status === "approved").length;
console.log(
  `\n${subject}: ${conceptRows.length} concepts, ${linkRows.length} spec-point links (${newLinks.length} new, ${staleLinks.length} live but not in the files); ${live} notes to publish, ${publish.length - live} as drafts, ${failed} not loaded.`,
);

if (staleLinks.length && !args.includes("--prune"))
  console.log(
    `${staleLinks.length} live links are not in the files and will be left alone (--prune removes them).`,
  );
if (!write) {
  console.log("Preview only. Re-run with --write to load.");
} else {
  await upsert("note_concepts", conceptRows, "id");
  if (args.includes("--prune"))
    for (const l of staleLinks)
      await api(
        `note_concept_spec_points?concept_id=eq.${l.concept_id}&spec_point_id=eq.${l.spec_point_id}`,
        { method: "DELETE", headers: { Prefer: "return=minimal" } },
      );
  for (let i = 0; i < newLinks.length; i += 500)
    await upsert("note_concept_spec_points", newLinks.slice(i, i + 500), "concept_id,spec_point_id");
  // Primary flags can change on a link that is already live.
  for (let i = 0; i < linkRows.length; i += 500)
    await upsert("note_concept_spec_points", linkRows.slice(i, i + 500), "concept_id,spec_point_id");
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
