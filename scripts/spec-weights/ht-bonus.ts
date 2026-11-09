/**
 * Add the Higher-tier bonus to GCSE points that were weighted before their tier
 * marker existed (8 Nov 2026).
 *
 * The scorers add HT_ONLY (+0.3) to any point whose wording says "(HT only)".
 * Two groups never got it:
 *   - Edexcel and OCR GCSE: weights were loaded on 6 Oct, and the "(HT only)" /
 *     "(HT only: part)" markers were read from the specs' bold type on 17–18 Oct.
 *     A part marker gets the full bonus, as an AQA section with one Higher-tier
 *     bullet does.
 *   - AQA points whose marker sits in the title only (score_db.ts reads the
 *     description). AQA GCSE Biology is left out: it was scored from the spec PDF,
 *     whose section text may already have carried the heading's marker.
 *
 * Writes the new weights into out/<course>.csv, the source of truth; then
 * load-weights.ts loads them. Prints each change and, per course, how many
 * topics change length in a 34-week year.
 *
 *   bun run scripts/spec-weights/ht-bonus.ts          # report only
 *   bun run scripts/spec-weights/ht-bonus.ts --csv    # also rewrite the CSVs
 *
 * Idempotent per point: the bonus is only added where the CSV weight still
 * equals the live weight it started from (re-running after a load is a no-op
 * report, because the live weight then already includes it — see `done`).
 */
import { computePacing, isTeachBand } from "../../src/lib/planner/pacing";
import { addWeeks, mondayOf } from "../../src/lib/planner/week";

const HT_ONLY = 0.3;
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
const writeCsv = process.argv.includes("--csv");
const headers = { apikey: key, Authorization: `Bearer ${key}` };

interface Topic {
  id: string;
  title: string;
  sort_order: number;
  subject: string;
  board: string;
  level: string;
}
interface Point {
  id: string;
  topic_id: string;
  code: string;
  title: string;
  description: string | null;
  weight: string;
  sort_order: number;
}

async function all<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { ...headers, Range: `${from}-${from + 999}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`);
    const page = (await res.json()) as T[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

const topics = await all<Topic>(
  "topics?select=id,title,sort_order,subject,board,level&level=in.(gcse,gcse_trilogy)&order=id",
);
const points = await all<Point>(
  "spec_points?select=id,topic_id,code,title,description,weight,sort_order&order=id",
);
const topicById = new Map(topics.map((t) => [t.id, t]));

const DESC_HT = /\(ht only(?::[^)]*)?\)|\(higher tier only\)/i;
const TITLE_HT = /\(ht only\)|, ht\)|\(ht\)/i;
/** Already counted: the scorers' own rule, on the text they read. */
const SCORED_HT = /\(ht only\)|\(higher tier only\)/i;

function needsBonus(t: Topic, p: Point): string | null {
  const desc = p.description ?? "";
  if (t.board === "edexcel" || t.board === "ocr") {
    const m = desc.match(DESC_HT);
    return m ? m[0] : null;
  }
  if (t.board === "aqa") {
    if (t.level === "gcse" && t.subject === "biology") return null;
    if (SCORED_HT.test(desc)) return null;
    const m = p.title.match(TITLE_HT);
    return m ? `title ${m[0]}` : null;
  }
  return null;
}

/** One CSV line into its raw fields, quotes kept, so joining with "," rebuilds it. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    if (ch === "," && !quoted) {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

const courseKey = (t: Topic) => `${t.board}-${t.level}-${t.subject}`;
const changes = new Map<
  string,
  { p: Point; t: Topic; marker: string; from: number; to: number }[]
>();
for (const p of points) {
  const t = topicById.get(p.topic_id);
  if (!t) continue;
  const marker = needsBonus(t, p);
  if (!marker) continue;
  const from = Number(p.weight);
  const to = Math.round((from + HT_ONLY) * 100) / 100;
  const list = changes.get(courseKey(t)) ?? [];
  list.push({ p, t, marker, from, to });
  changes.set(courseKey(t), list);
}

/** Weeks per topic for one course, as the planner cuts a 34-week GCSE year. */
const START = mondayOf(new Date("2026-09-07T12:00:00Z"));
function weeksPerTopic(course: string, weightOf: (p: Point) => number) {
  const ts = topics
    .filter((t) => courseKey(t) === course)
    .sort((a, b) => a.sort_order - b.sort_order);
  const inputs = ts
    .map((t) => ({
      topicId: t.id,
      title: t.title,
      weight: points.filter((p) => p.topic_id === t.id).reduce((s, p) => s + weightOf(p), 0),
    }))
    .filter((x) => x.weight > 0);
  const out = new Map<string, number>();
  for (const b of computePacing(inputs, START, addWeeks(START, 34))) {
    if (!isTeachBand(b)) continue;
    out.set(b.topicId, (out.get(b.topicId) ?? 0) + b.weeks);
  }
  return out;
}

let total = 0;
for (const [course, list] of [...changes.entries()].sort()) {
  const bump = new Map(list.map((c) => [c.p.id, c.to]));
  const before = weeksPerTopic(course, (p) => Number(p.weight));
  const after = weeksPerTopic(course, (p) => bump.get(p.id) ?? Number(p.weight));
  const moved = [...after.entries()].filter(([id, w]) => (before.get(id) ?? 0) !== w);
  const courseWeight = points
    .filter((p) => topicById.get(p.topic_id) && courseKey(topicById.get(p.topic_id)!) === course)
    .reduce((s, p) => s + Number(p.weight), 0);
  console.log(
    `\n${course}: ${list.length} points +${HT_ONLY} (course weight +${((list.length * HT_ONLY * 100) / courseWeight).toFixed(1)}%); ` +
      `${moved.length} topic(s) change length in a 34-week year`,
  );
  for (const [id, w] of moved) {
    const t = topicById.get(id)!;
    console.log(`    topic "${t.title}": ${before.get(id) ?? 0} → ${w} weeks`);
  }
  for (const c of list.sort((a, b) => a.p.code.localeCompare(b.p.code, "en", { numeric: true })))
    console.log(`  ${c.p.code.padEnd(16)} ${c.from.toFixed(2)} → ${c.to.toFixed(2)}  ${c.marker}`);
  total += list.length;

  if (writeCsv) {
    const file = `${import.meta.dir}/out/${course}.csv`;
    const lines = (await Bun.file(file).text()).split("\n");
    const weightAt = lines[0].split(",").indexOf("weight");
    if (weightAt < 0) throw new Error(`${course}: no weight column`);
    const byCode = new Map(list.map((c) => [c.p.code, c]));
    let n = 0;
    const next = lines.map((line, i) => {
      if (i === 0 || !line) return line;
      const fields = splitCsvLine(line);
      const c = byCode.get(fields[0]);
      if (!c) return line;
      if (Number(fields[weightAt]) !== c.from)
        throw new Error(
          `${course} ${fields[0]}: CSV weight ${fields[weightAt]} is not the live ${c.from}`,
        );
      n++;
      fields[weightAt] = c.to.toFixed(2);
      return fields.join(",");
    });
    if (n !== list.length) throw new Error(`${course}: matched ${n} of ${list.length} CSV rows`);
    await Bun.write(file, next.join("\n"));
  }
}
console.log(
  `\n${total} points in ${changes.size} courses${writeCsv ? " — CSVs rewritten; load with load-weights.ts" : " — report only, pass --csv to rewrite the CSVs"}`,
);
