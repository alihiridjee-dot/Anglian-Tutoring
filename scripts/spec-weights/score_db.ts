/**
 * Size spec points from their saved wording, for every course at once.
 *
 * The Biology trees were sized from their spec PDFs (score_by_code.py,
 * score_aqa_gcse_biology.py). Every course's descriptions are now the board's
 * own wording, so the same rules can read the database instead of a PDF per
 * board. The rules and numbers below are those two scripts', unchanged, except
 * where noted:
 *
 *  - "be able to" is skipped to find the real command word (Edexcel A level
 *    writes "Be able to calculate …"), and "Core practical:" counts as a practical.
 *  - Sub-items "(a)", "(ii)" count like bullets: they are the same thing laid out
 *    inline, and the descriptions write them that way.
 *  - Maths/apparatus skill tags (MS, AT, M1a) are not scored. The descriptions
 *    leave them out (they sit in the spec's side column), and they were the
 *    smallest signal, so a course is scored consistently without them.
 *
 * Only ratios matter (see README), so a course is consistent if every point in it
 * is scored the same way. AQA-style courses (AQA at any level) are whole content
 * sections and use the section rules; everything else is one statement per point.
 *
 *   bun run scripts/spec-weights/score_db.ts            # unweighted courses → out/*.csv + report
 *   bun run scripts/spec-weights/score_db.ts --check    # also re-score the weighted trees vs their live weights
 *
 * Writes nothing to the database. Review the CSVs, then load them with
 * load-weights.ts.
 */
import { computePacing, withWeeklyPoints, weightOf, isTeachBand } from "@/lib/planner/pacing";
import { addWeeks, mondayOf, toDateKey } from "@/lib/planner/week";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
const check = process.argv.includes("--check");
const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ----------------------------------------------------------------- scoring

/** score_aqa_gcse_biology.py — what an AQA section asks the student to do. */
const SECTION_VERB: Record<string, number> = {
  state: 1.0,
  name: 1.0,
  recall: 1.1,
  recognise: 1.1,
  identify: 1.2,
  describe: 1.3,
  demonstrate: 1.4,
  understand: 1.4,
  draw: 1.5,
  measure: 1.5,
  use: 1.5,
  estimate: 1.6,
  extract: 1.6,
  interpret: 1.6,
  plot: 1.6,
  apply: 1.7,
  explain: 1.7,
  calculate: 1.8,
  compare: 1.8,
  translate: 1.8,
  discuss: 1.9,
  predict: 1.9,
  analyse: 2.0,
  evaluate: 2.1,
};

/** score_by_code.py — the command word a statement opens with. */
const STATEMENT_VERB: Record<string, number> = {
  state: 1.0,
  name: 1.0,
  know: 1.05,
  recall: 1.1,
  recognise: 1.1,
  identify: 1.2,
  list: 1.1,
  describe: 1.3,
  demonstrate: 1.4,
  understand: 1.4,
  draw: 1.5,
  label: 1.3,
  measure: 1.5,
  use: 1.5,
  estimate: 1.6,
  interpret: 1.6,
  plot: 1.6,
  apply: 1.7,
  explain: 1.7,
  calculate: 1.8,
  compare: 1.8,
  predict: 1.9,
  discuss: 1.9,
  analyse: 2.0,
  evaluate: 2.1,
  investigate: 2.2,
  practical: 2.4,
};

const PRACTICAL = 2.0;
const PER_EXTRA_ASK = 0.35;
const PER_ITEM = 0.22;
const HT_ONLY = 0.3;
const VOLUME_CAP = 1.6;

/** Bullets plus inline sub-items: "• …", "(a) …", "(ii) …". */
function items(text: string): number {
  const bullets = (text.match(/•/g) ?? []).length;
  const subs = (text.match(/\((?:[a-h]|i{1,3}|iv|v|vi{1,3}|ix|x)\)\s/g) ?? []).length;
  return bullets + subs;
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** One AQA content section (score_aqa_gcse_biology.py → score_section). */
export function scoreSection(text: string): number {
  const low = text.toLowerCase();
  const asks = [...low.matchAll(/students should be able to\s*:?\s*(?:•\s*)?([a-z]+)/g)].map(
    (m) => m[1],
  );
  const scores = asks.map((v) => SECTION_VERB[v] ?? 1.5);
  let w = scores.length ? Math.max(...scores) : 1.3;
  w += PER_EXTRA_ASK * Math.max(0, scores.length - 1);
  w += PER_ITEM * items(text);
  if (/required practical/.test(low)) w += PRACTICAL;
  if (/\(ht only\)|\(higher tier only\)/.test(low)) w += HT_ONLY;
  w += Math.min(VOLUME_CAP, Math.max(0, words(text) - 110) / 130);
  return Math.round(w * 100) / 100;
}

/** One numbered statement (score_by_code.py → score_statement). */
export function scoreStatement(text: string): number {
  const low = text.toLowerCase();
  const practicalLead = /^\s*(core practical|practical|required practical)\b/.test(low);
  const lead = low
    .replace(/^\s*(core practical|required practical|practical)\s*:?\s*/, "")
    .replace(/^\s*(\(i\)|\(a\))\s*/, "")
    .replace(/^\s*(students should |candidates should )?be able to\s+/, "");
  const first = lead.match(/^\s*([a-z]+)/)?.[1] ?? "";
  let w = STATEMENT_VERB[first] ?? 1.4;
  if (practicalLead || /investigate/.test(low.split(":")[0].slice(0, 60))) w += PRACTICAL;
  w += PER_ITEM * items(text);
  if (/\(ht only\)|\(higher tier only\)/.test(low)) w += HT_ONLY;
  w += Math.min(VOLUME_CAP, Math.max(0, words(text) - 25) / 45);
  return Math.round(w * 100) / 100;
}

// ------------------------------------------------------------------ courses

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

const topics = await api<Topic[]>(
  "topics?select=id,title,sort_order,subject,board,level&order=sort_order&limit=5000",
);
const points: Point[] = [];
for (let from = 0; ; from += 1000) {
  const res = await fetch(
    `${url}/rest/v1/spec_points?select=id,topic_id,code,title,description,weight,sort_order&order=id`,
    {
      headers: { ...headers, Range: `${from}-${from + 999}` },
    },
  );
  const page = (await res.json()) as Point[];
  points.push(...page);
  if (page.length < 1000) break;
}

const courseKey = (t: Topic) => `${t.board}-${t.level}-${t.subject}`;
const courses = new Map<string, { topics: Topic[]; points: Map<string, Point[]> }>();
for (const t of topics) {
  const c = courses.get(courseKey(t)) ?? { topics: [], points: new Map() };
  c.topics.push(t);
  c.points.set(t.id, []);
  courses.set(courseKey(t), c);
}
const topicById = new Map(topics.map((t) => [t.id, t]));
for (const p of points) {
  const t = topicById.get(p.topic_id);
  if (t) courses.get(courseKey(t))!.points.get(t.id)!.push(p);
}
for (const c of courses.values()) {
  c.topics.sort((a, b) => a.sort_order - b.sort_order);
  for (const list of c.points.values()) list.sort((a, b) => a.sort_order - b.sort_order);
}

function score(board: string, p: Point): number {
  const text = `${p.description ?? ""}`.trim() || p.title;
  return board === "aqa" ? scoreSection(text) : scoreStatement(text);
}

// ------------------------------------------------------------ week balance

/** First Monday of September 2026. GCSE runs over 34 teaching weeks (README); A level is two years of them. */
const START = mondayOf(new Date("2026-09-07T12:00:00Z"));
const teachingWeeks = (level: string) => (level === "alevel" ? 68 : 34);

/**
 * Heaviest week ÷ lightest week. The plan is cut with `plan` weights and each
 * week is then measured with `measure` weights — so "before" is today's count
 * split measured by real workload, as in the README's table.
 */
function balance(
  c: { topics: Topic[]; points: Map<string, Point[]> },
  weeks: number,
  plan: (p: Point) => number,
  measure: (p: Point) => number,
) {
  const inputs = c.topics
    .filter((t) => (c.points.get(t.id) ?? []).length > 0)
    .map((t) => ({
      topicId: t.id,
      title: t.title,
      weight: (c.points.get(t.id) ?? []).reduce((s, p) => s + plan(p), 0),
    }));
  const bands = computePacing(inputs, START, addWeeks(START, weeks));
  const refs = new Map(
    c.topics.map((t) => [
      t.id,
      (c.points.get(t.id) ?? []).map((p) => ({
        specPointId: p.id,
        code: p.code,
        title: p.title,
        weight: plan(p),
      })),
    ]),
  );
  const byId = new Map(
    c.topics.flatMap((t) => (c.points.get(t.id) ?? []).map((p) => [p.id, p] as const)),
  );
  const load = new Map<string, number>();
  const topicOfWeek = new Map<string, string>();
  for (const b of withWeeklyPoints(bands, refs)) {
    if (!isTeachBand(b)) continue;
    for (const [week, pts] of Object.entries(b.pointsByWeek ?? {})) {
      load.set(
        week,
        (load.get(week) ?? 0) + pts.reduce((s, r) => s + measure(byId.get(r.specPointId)!), 0),
      );
      topicOfWeek.set(week, `${b.title} [${pts.map((r) => r.code).join(" ")}]`);
    }
  }
  const loads = Array.from(
    { length: weeks },
    (_, i) => load.get(toDateKey(addWeeks(START, i))) ?? 0,
  );
  const filled = loads.filter((x) => x > 0);
  const sorted = [...filled].sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * (sorted.length - 1)))];
  const keys = Array.from({ length: weeks }, (_, i) => toDateKey(addWeeks(START, i)));
  const heavy = keys.reduce((a, k) => ((load.get(k) ?? 0) > (load.get(a) ?? 0) ? k : a), keys[0]);
  const light = keys
    .filter((k) => (load.get(k) ?? 0) > 0)
    .reduce(
      (a, k) => ((load.get(k) ?? 0) < (load.get(a) ?? 0) ? k : a),
      keys.find((k) => (load.get(k) ?? 0) > 0) ?? keys[0],
    );
  return {
    ratio: filled.length ? Math.max(...filled) / Math.min(...filled) : 0,
    spread: sorted.length ? q(0.9) / q(0.1) : 0,
    empty: loads.length - filled.length,
    heaviest: `${(load.get(heavy) ?? 0).toFixed(1)} ${topicOfWeek.get(heavy) ?? ""}`,
    lightest: `${(load.get(light) ?? 0).toFixed(1)} ${topicOfWeek.get(light) ?? ""}`,
  };
}

// ------------------------------------------------------------------ output

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const report: string[] = [];
const summary: Record<string, unknown>[] = [];

for (const [name, c] of [...courses.entries()].sort()) {
  const all = c.topics.flatMap((t) => c.points.get(t.id) ?? []);
  if (all.length === 0) continue;
  const [board, level] = name.split("-");
  const weighted = all.some((p) => Number(p.weight) !== 1);
  if (weighted && !check) continue;

  const scored = new Map(all.map((p) => [p.id, score(board, p)]));
  if (weighted) {
    // Validation: how closely does reading the saved wording reproduce the PDF-based weights?
    const xs = all.map((p) => Number(p.weight)),
      ys = all.map((p) => scored.get(p.id)!);
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    const mx = mean(xs),
      my = mean(ys);
    const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const r =
      cov /
      Math.sqrt(
        xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0),
      );
    const live = balance(
      c,
      teachingWeeks(level),
      (p) => Number(p.weight),
      (p) => Number(p.weight),
    );
    const fresh = balance(
      c,
      teachingWeeks(level),
      (p) => scored.get(p.id)!,
      (p) => Number(p.weight),
    );
    report.push(
      `CHECK ${name}: r=${r.toFixed(2)} vs live weights; week balance (measured by live weights) planned on live ${live.ratio.toFixed(1)}x, planned on rescored ${fresh.ratio.toFixed(1)}x`,
    );
    continue;
  }

  const real = (p: Point) => scored.get(p.id)!;
  const before = balance(c, teachingWeeks(level), () => 1, real);
  const after = balance(c, teachingWeeks(level), real, real);
  const after34 = level === "alevel" ? balance(c, 34, real, real) : null;
  const rows = ["code,title,weight,topic"];
  for (const t of c.topics)
    for (const p of c.points.get(t.id) ?? [])
      rows.push([p.code, p.title, String(scored.get(p.id)), t.title].map(csvCell).join(","));
  await Bun.write(`${import.meta.dir}/out/${name}.csv`, rows.join("\n") + "\n");
  const ws = all.map((p) => scored.get(p.id)!);
  const byWeight = [...all].sort((a, b) => scored.get(b.id)! - scored.get(a.id)!);
  summary.push({
    course: name,
    points: all.length,
    topics: c.topics.length,
    min: Math.min(...ws),
    max: Math.max(...ws),
    mean: Math.round((ws.reduce((s, x) => s + x, 0) / ws.length) * 100) / 100,
    before: `${before.ratio.toFixed(1)}x${before.empty ? ` (${before.empty} empty)` : ""}`,
    after: `${after.ratio.toFixed(1)}x${after.empty ? ` (${after.empty} empty)` : ""}`,
    spreadBefore: `${before.spread.toFixed(1)}x`,
    spreadAfter: `${after.spread.toFixed(1)}x`,
    heaviestWeek: after.heaviest,
    lightestWeek: after.lightest,
    afterOneYear: after34 ? `${after34.ratio.toFixed(1)}x` : null,
    weeks: teachingWeeks(level),
    heaviest: byWeight
      .slice(0, 10)
      .map((p) => ({ code: p.code, title: p.title, weight: scored.get(p.id) })),
    lightest: byWeight
      .slice(-10)
      .reverse()
      .map((p) => ({ code: p.code, title: p.title, weight: scored.get(p.id) })),
  });
  report.push(
    `${name.padEnd(30)} ${String(all.length).padStart(4)} pts  ${ws.length ? `${Math.min(...ws)}–${Math.max(...ws)}` : ""}  week balance ${before.ratio.toFixed(1)}x → ${after.ratio.toFixed(1)}x  (90/10 spread ${before.spread.toFixed(1)}x → ${after.spread.toFixed(1)}x)${after.empty ? `, ${after.empty} empty weeks` : ""}${after34 ? ` (one-year runway ${after34.ratio.toFixed(1)}x)` : ""}`,
  );
}

// Once every course is weighted there is nothing to score; keep the last review rather than blanking it.
if (summary.length > 0)
  await Bun.write(`${import.meta.dir}/out/score-db-summary.json`, JSON.stringify(summary, null, 1));
console.log(
  report.length ? report.join("\n") : "Every course already has weights; nothing to score.",
);
