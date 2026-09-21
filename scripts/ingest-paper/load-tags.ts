/**
 * Load spec-point tags for exam exemplars into `exam_exemplar_spec_points`.
 *
 * Tagging is the judgement half of ingestion: it says which part of the
 * specification a real exam question actually credits, and it is what lets
 * generation ground a new question in questions on the *same point* rather than
 * whatever the board happened to print in the same subject.
 *
 *   bun run scripts/ingest-paper/load-tags.ts scripts/ingest-paper/tags/*.txt
 *   bun run scripts/ingest-paper/load-tags.ts … --write
 *
 * Preview by default — it prints what it would write and touches nothing.
 * Re-running replaces that paper's tags, so a correction in the file is the
 * whole edit; nothing has to be undone by hand.
 *
 * Tag files are plain text, one line per rule, named after the paper exactly as
 * the exemplars were loaded (aqa-biology-gcse-2018-p1F.txt):
 *
 *     01.1,01.2 1.6,6.4      # these labels credit these points
 *     # comments and blank lines are ignored
 *
 * Codes are written without their board prefix — `1.6` for `AQA 1.6`, `1.1.5S`
 * for `CAIE 1.1.5S` — because the prefix is already in the filename and
 * repeating it 1,600 times invites a typo. A label or a code that doesn't exist
 * is reported, not guessed at.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY: the tables are behind
 * tutor-only RLS and this runs outside a session.
 */
import { indexSpecPoints, PAPER_STEM } from "./specCodes";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const write = args.includes("--write");
if (files.length === 0) throw new Error("Give at least one tag file");

const headers = {
  apikey: key,
  ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
  "Content-Type": "application/json",
};

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers });
  if (!res.ok)
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Provenance from the filename, matching the one the exemplars were loaded under. */
function provenance(path: string) {
  const stem = path
    .split("/")
    .pop()!
    .replace(/\.txt$/, "");
  const m = stem.match(PAPER_STEM);
  if (!m) throw new Error(`${path}: filename must look like aqa-biology-gcse-2018-p1F.txt`);
  return {
    board: m[1],
    subject: m[2],
    level: m[3],
    year: m[4] === "unknown" ? null : m[4],
    paper: m[5],
    tier: m[6] || null,
  };
}

const eq = (column: string, value: string | null) =>
  `${column}=${value === null ? "is.null" : `eq.${encodeURIComponent(value)}`}`;

let totalPairs = 0;
let totalUntagged = 0;

for (const file of files) {
  const p = provenance(file);

  // What this paper's rows are, and what the specification calls its points.
  const exemplars: { id: string; question_label: string }[] = await api(
    `exam_exemplars?select=id,question_label&${eq("board", p.board)}&${eq("subject", p.subject)}` +
      `&${eq("level", p.level)}&${eq("year", p.year)}&${eq("paper", p.paper)}&${eq("tier", p.tier)}`,
  );
  const byLabel = new Map(exemplars.map((e) => [e.question_label, e.id]));

  const points: { id: string; code: string }[] = await api(
    `spec_points?select=id,code,topics!inner(board,level,subject)&topics.board=eq.${p.board}` +
      `&topics.level=eq.${p.level}&topics.subject=eq.${p.subject}`,
  );
  const byCode = indexSpecPoints(points);

  const pairs = new Map<string, Set<string>>();
  const unknownLabels: string[] = [];
  const unknownCodes: string[] = [];

  for (const raw of (await Bun.file(file).text()).split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [labelPart, codePart] = line.split(/\s+/);
    if (!codePart) throw new Error(`${file}: "${raw.trim()}" has labels but no spec point codes`);
    for (const label of labelPart.split(",").filter(Boolean)) {
      const exemplarId = byLabel.get(label);
      if (!exemplarId) {
        unknownLabels.push(label);
        continue;
      }
      for (const code of codePart.split(",").filter(Boolean)) {
        const pointId = byCode.get(code);
        if (!pointId) {
          unknownCodes.push(code);
          continue;
        }
        (pairs.get(exemplarId) ?? pairs.set(exemplarId, new Set()).get(exemplarId)!).add(pointId);
      }
    }
  }

  const tagged = pairs.size;
  const links = [...pairs.values()].reduce((n, s) => n + s.size, 0);
  const untagged = exemplars.length - tagged;
  totalPairs += links;
  totalUntagged += untagged;

  console.log(
    `${file}\n  ${tagged}/${exemplars.length} questions tagged, ${links} links` +
      (untagged ? `, ${untagged} left untagged` : "") +
      (unknownLabels.length
        ? `\n    unknown labels: ${[...new Set(unknownLabels)].join(", ")}`
        : "") +
      (unknownCodes.length ? `\n    unknown codes: ${[...new Set(unknownCodes)].join(", ")}` : ""),
  );
  if (unknownLabels.length || unknownCodes.length) process.exitCode = 1;

  if (write && links > 0) {
    // Replace this paper's tags wholesale: a file is the source of truth for
    // the questions it names, so a corrected line must be able to remove a tag.
    const ids = [...pairs.keys()];
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      await api(`exam_exemplar_spec_points?exemplar_id=in.(${batch.join(",")})`, {
        method: "DELETE",
      });
    }
    const rows = [...pairs].flatMap(([exemplar_id, set]) =>
      [...set].map((spec_point_id) => ({ exemplar_id, spec_point_id })),
    );
    for (let i = 0; i < rows.length; i += 500) {
      await api("exam_exemplar_spec_points?on_conflict=exemplar_id,spec_point_id", {
        method: "POST",
        body: JSON.stringify(rows.slice(i, i + 500)),
      });
    }
    console.log(`  wrote ${rows.length}`);
  }
}

console.log(
  `\n  ${totalPairs} links${totalUntagged ? `, ${totalUntagged} questions left untagged` : ""}`,
);
if (!write) console.log("  Preview only. Re-run with --write to insert.");
