/**
 * Load reviewed spec-point weights from the CSVs in ./out into the database.
 *
 * The CSVs are the source of truth — regenerate them with the scoring scripts,
 * review them, then run this. Idempotent: re-running writes the same values.
 *
 *   bun run scripts/spec-weights/load-weights.ts            # report only
 *   bun run scripts/spec-weights/load-weights.ts --write
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role, because
 * spec_points is tutor-write behind RLS and this runs headless).
 */

const TREES: Record<string, { board: string; level: string }> = {
  "aqa-gcse-biology": { board: "aqa", level: "gcse" },
  "edexcel-gcse-biology": { board: "edexcel", level: "gcse" },
  "edexcel-igcse-biology": { board: "edexcel", level: "igcse" },
  "ocr-gcse-biology": { board: "ocr", level: "gcse" },
};
const SUBJECT = "biology";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
const write = process.argv.includes("--write");

const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/** `code,title,weight,...` — quoted fields may contain commas. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') {
        cell += c;
      } else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = false;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") {
      cell += c;
    }
  }
  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((x) => x !== ""));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

let totalWritten = 0;
for (const [file, { board, level }] of Object.entries(TREES)) {
  const csv = parseCsv(await Bun.file(`${import.meta.dir}/out/${file}.csv`).text());
  const wanted = new Map(
    csv.filter((r) => r.weight).map((r) => [r.code, Number(r.weight)] as const),
  );

  const topics: { id: string }[] = await api(
    `topics?select=id&subject=eq.${SUBJECT}&board=eq.${board}&level=eq.${level}`,
  );
  const topicIds = topics.map((t) => t.id);
  const points: { id: string; code: string; weight: string }[] = await api(
    `spec_points?select=id,code,weight&topic_id=in.(${topicIds.join(",")})`,
  );

  const changes = points
    .filter((p) => wanted.has(p.code) && Number(p.weight) !== wanted.get(p.code))
    .map((p) => ({ id: p.id, weight: wanted.get(p.code)! }));
  const unmatched = [...wanted.keys()].filter((c) => !points.some((p) => p.code === c));

  console.log(
    `${file}: ${points.length} points in db, ${wanted.size} in csv, ` +
      `${changes.length} to update${unmatched.length ? `, ${unmatched.length} NOT IN DB` : ""}`,
  );
  if (unmatched.length) {
    console.log(`  unmatched: ${unmatched.slice(0, 10).join(", ")}`);
    throw new Error(`${file}: refusing to write with unmatched codes`);
  }
  if (!write) continue;

  // PostgREST has no bulk "different value per row" update, and upsert would
  // need every not-null column. One PATCH each, in small batches.
  for (let i = 0; i < changes.length; i += 20) {
    await Promise.all(
      changes.slice(i, i + 20).map((c) =>
        api(`spec_points?id=eq.${c.id}`, {
          method: "PATCH",
          body: JSON.stringify({ weight: c.weight }),
        }),
      ),
    );
  }
  totalWritten += changes.length;
}

console.log(write ? `\nwrote ${totalWritten} weights` : "\ndry run — pass --write to apply");
