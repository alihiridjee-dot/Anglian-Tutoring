/**
 * Before loading a GCSE-layer pass: every changed draft must equal the live
 * note plus its new GCSE extra sections and nothing else, and the base the
 * drafts were written on must itself equal live.
 *
 *   bun scripts/notes/gcse-layers/live-check.ts <subject> <base ref or tree> [--ids a,b]
 *
 * Read-only. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
const [subject, base, ...rest] = process.argv.slice(2);
if (!subject || !base) throw new Error("Usage: live-check.ts <subject> <base> [--ids a,b]");
const idsAt = rest.indexOf("--ids");
const only = idsAt >= 0 ? new Set(rest[idsAt + 1].split(",")) : null;
const headers = {
  apikey: key,
  ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
};
const git = (...a: string[]) => execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" });
const changed = git("diff", "--name-only", base, "--", `scripts/notes/drafts/${subject}/`)
  .split("\n")
  .filter(Boolean)
  .map((f) => f.split("/").pop()!.replace(/\.json$/, ""))
  .filter((id) => !only || only.has(id));
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
const strip = (n: any) => {
  const c = JSON.parse(JSON.stringify(n));
  delete c.meta.status;
  delete c.meta.checked_at;
  return JSON.stringify(stable(c));
};
let ok = 0,
  bad = 0;
for (let i = 0; i < changed.length; i += 40) {
  const batch = changed.slice(i, i + 40);
  const res = await fetch(
    `${url}/rest/v1/notes?select=concept_id,body,status&concept_id=in.(${batch.join(",")})`,
    { headers },
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const live = new Map(((await res.json()) as any[]).map((r) => [r.concept_id, r]));
  for (const id of batch) {
    const now = JSON.parse(readFileSync(join(ROOT, "scripts/notes/drafts", subject, `${id}.json`), "utf8"));
    const baseNote = JSON.parse(git("show", `${base}:scripts/notes/drafts/${subject}/${id}.json`));
    const row = live.get(id);
    if (!row) {
      console.log(`✗ ${id}: not live`);
      bad++;
      continue;
    }
    const problems: string[] = [];
    if (strip(row.body) !== strip(baseNote)) problems.push("live differs from the base draft");
    // Remove the sections added since the base, then compare with live.
    const trimmed = JSON.parse(JSON.stringify(now));
    for (const b of ["aqa", "edexcel", "ocr"]) {
      const h = baseNote.boards?.[b],
        n = trimmed.boards?.[b];
      if (!h || !n) continue;
      const keep = (h.extra ?? []).length;
      if (n.extra) {
        n.extra = n.extra.slice(0, keep);
        if (!n.extra.length) delete n.extra;
      }
    }
    if (strip(trimmed) !== strip(row.body)) problems.push("draft minus new sections differs from live");
    if (row.status !== "approved") problems.push(`live status is ${row.status}`);
    if (problems.length) {
      bad++;
      console.log(`✗ ${id}: ${problems.join("; ")}`);
    } else ok++;
  }
}
console.log(`${subject}: ${ok} changed drafts are live + new sections only, ${bad} with differences`);
if (bad) process.exit(1);
