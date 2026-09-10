/**
 * File loaded exam questions under the specification points they credit.
 *
 * Without this the library is a pile. `exam_generation_context` grades what it
 * retrieves as `exact` (tagged with this very point), `topic` (tagged with a
 * sibling point) or `style` (same course, nothing else in common) — and an
 * untagged row can only ever be `style`, so generating for a spec point falls
 * back to house style no matter how many papers were ingested. Tagging is what
 * turns 500 rows into coverage of 2,063 points.
 *
 *   bun run scripts/ingest-paper/tag-exemplars.ts --board ocr --subject biology --level gcse
 *   bun run scripts/ingest-paper/tag-exemplars.ts --board ocr --subject biology --level gcse --write
 *
 * Preview by default, like the loader. One course at a time, because the whole
 * point is to show the model only that course's specification: a physics point
 * is never the right answer for a biology question, and offering it as a
 * candidate is how that mistake gets made.
 *
 * Many-to-many on purpose. A six-marker on photosynthesis genuinely credits
 * three points, and forcing a single choice understates coverage exactly where
 * it is thinnest.
 *
 * Costs a few pence per course: the specification is sent once and cached, and
 * each batch of questions after that reads it at a tenth the price.
 *
 * Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY.
 */
import Anthropic from "@anthropic-ai/sdk";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
if (!apiKey) throw new Error("ANTHROPIC_API_KEY must be set");

const MODEL = flag("model") ?? "claude-sonnet-5";
const board = flag("board");
const subject = flag("subject");
const level = flag("level");
const batchSize = Number(flag("batch") ?? 8);
const write = process.argv.includes("--write");
if (!board || !subject || !level)
  throw new Error(
    "Give --board, --subject and --level, e.g. --board ocr --subject biology --level gcse",
  );

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function db(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key!,
      ...(key!.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

type SpecPoint = { id: string; code: string; title: string; description: string | null };
type Topic = { id: string; code: string; title: string; spec_points: SpecPoint[] };
type Exemplar = {
  id: string;
  question_label: string;
  prompt: string;
  shared_context: string | null;
  mark_scheme: string | null;
  marks: number | null;
  year: string | null;
  paper: string | null;
};

// It may only choose from what it is shown, and it is shown one course. The
// failure this guards against is a plausible-looking code for a point that does
// not exist, which would tag nothing and look like it had worked.
const RULES = `You file real exam questions under the specification points they assess.

You will be given one course's specification — its topics and their points — followed by questions from that course's past papers.

For each question, return the codes of the specification points it actually credits. Rules:

- Choose only from the codes given to you. Never write a code that is not in the list, and never invent a plausible-looking one.
- Judge what a candidate has to know to earn the marks, not what the question mentions in passing. A question set in the context of a car journey is not a transport question.
- Most questions credit one point. A long-answer question often credits two or three. Return every point that carries marks, in the order they matter.
- Return an empty list when nothing in this specification genuinely fits. That is a real answer — the paper may be from a different specification version, or the question may assess a skill the specification does not itemise — and it is much better than a loose match.
- Set "uncertain" when the question text is too damaged or too dependent on a missing figure to judge. Its tags will be held back.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["tags"],
  properties: {
    tags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "codes", "uncertain"],
        properties: {
          id: { type: "string" },
          codes: { type: "array", items: { type: "string" } },
          uncertain: { type: "boolean" },
        },
      },
    },
  },
};

const client = new Anthropic({ apiKey });
const spend = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
const PRICE: Record<string, [number, number, number, number]> = {
  "claude-sonnet-5": [2, 2.5, 0.2, 10],
  "claude-haiku-4-5-20251001": [1, 1.25, 0.1, 5],
  "claude-opus-5": [5, 6.25, 0.5, 25],
};

const topics = (await db(
  `topics?select=id,code,title,spec_points(id,code,title,description)` +
    `&board=eq.${board}&subject=eq.${subject}&level=eq.${level}&order=sort_order`,
)) as Topic[];
const points = topics.flatMap((t) => t.spec_points ?? []);
if (points.length === 0)
  throw new Error(`No specification points for ${board}/${subject}/${level}`);
const byCode = new Map(points.map((p) => [p.code, p]));

const catalogue =
  `SPECIFICATION — ${board} ${subject} ${level}\n\n` +
  topics
    .map(
      (t) =>
        `${t.code} ${t.title}\n` +
        (t.spec_points ?? [])
          .map((p) => `  ${p.code}  ${p.title}${p.description ? ` — ${p.description}` : ""}`)
          .join("\n"),
    )
    .join("\n\n");

// Rows that need an image or failed a parser check are left alone: a question
// whose figure is missing cannot be judged from its text, and guessing its
// topic would be filing under the wrong heading rather than not filing.
const exemplars = (await db(
  `exam_exemplars?select=id,question_label,prompt,shared_context,mark_scheme,marks,year,paper` +
    `&board=eq.${board}&subject=eq.${subject}&level=eq.${level}` +
    `&needs_image=is.false&flags=eq.{}&order=year,paper,question_label`,
)) as Exemplar[];
const tagged = new Set(
  ((await db(`exam_exemplar_spec_points?select=exemplar_id`)) as { exemplar_id: string }[]).map(
    (l) => l.exemplar_id,
  ),
);
const pending = exemplars.filter((e) => !tagged.has(e.id));

console.log(
  `${board}/${subject}/${level} — ${points.length} specification points across ${topics.length} topics\n` +
    `  ${exemplars.length} usable exemplars, ${exemplars.length - pending.length} already tagged, ` +
    `${pending.length} to do`,
);
if (pending.length === 0) process.exit(0);

const links: { exemplar_id: string; spec_point_id: string }[] = [];
const unmatched: string[] = [];
const held: string[] = [];
const invented = new Set<string>();

for (let i = 0; i < pending.length; i += batchSize) {
  const batch = pending.slice(i, i + batchSize);
  process.stdout.write(`\r  tagging ${i + batch.length} of ${pending.length}   `);
  const questions = batch
    .map(
      (e) =>
        `--- id: ${e.id}\n` +
        `${e.year ?? "?"} paper ${e.paper ?? "?"} question ${e.question_label}` +
        ` (${e.marks ?? "?"} marks)\n` +
        (e.shared_context ? `Context: ${e.shared_context}\n` : "") +
        `Question: ${e.prompt}\n` +
        (e.mark_scheme ? `Mark scheme: ${e.mark_scheme}\n` : ""),
    )
    .join("\n");

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 4000,
    system: [{ type: "text", text: RULES, cache_control: { type: "ephemeral" } }],
    output_config: { format: { type: "json_schema", schema } },
    messages: [
      {
        role: "user",
        content: [
          // The specification is the cached prefix; only the questions change.
          { type: "text", text: catalogue, cache_control: { type: "ephemeral" } },
          { type: "text", text: `QUESTIONS\n\n${questions}\n\nTag every question above.` },
        ],
      },
    ],
  });
  const message = await stream.finalMessage();
  spend.input += message.usage.input_tokens;
  spend.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
  spend.cacheRead += message.usage.cache_read_input_tokens ?? 0;
  spend.output += message.usage.output_tokens;
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const result = JSON.parse(text) as {
    tags: { id: string; codes: string[]; uncertain: boolean }[];
  };

  for (const tag of result.tags) {
    const exemplar = batch.find((e) => e.id === tag.id);
    if (!exemplar) continue;
    if (tag.uncertain) {
      held.push(exemplar.question_label);
      continue;
    }
    const ids = tag.codes.map((code) => {
      const point = byCode.get(code);
      if (!point) invented.add(code);
      return point?.id;
    });
    const found = ids.filter((id): id is string => Boolean(id));
    if (found.length === 0) unmatched.push(exemplar.question_label);
    for (const spec_point_id of new Set(found))
      links.push({ exemplar_id: exemplar.id, spec_point_id });
  }
}
process.stdout.write("\r" + " ".repeat(40) + "\r");

const perExemplar = new Map<string, number>();
for (const l of links) perExemplar.set(l.exemplar_id, (perExemplar.get(l.exemplar_id) ?? 0) + 1);
const [p, w, r, o] = PRICE[MODEL] ?? [0, 0, 0, 0];
const usd = (spend.input * p + spend.cacheWrite * w + spend.cacheRead * r + spend.output * o) / 1e6;

console.log(
  `  ${perExemplar.size} exemplars tagged with ${links.length} points ` +
    `(${(links.length / (perExemplar.size || 1)).toFixed(1)} each)\n` +
    `  ${unmatched.length} matched nothing in this specification` +
    (unmatched.length ? `: ${unmatched.slice(0, 12).join(", ")}` : "") +
    `\n  ${held.length} held back as too damaged to judge` +
    (invented.size ? `\n  ignored ${invented.size} codes that are not in the specification` : ""),
);

if (write && links.length) {
  await db(`exam_exemplar_spec_points?on_conflict=exemplar_id,spec_point_id`, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify(links),
  });
  console.log(`  wrote ${links.length} links`);
} else if (!write) {
  console.log("  Preview only. Re-run with --write to save the tags.");
}
console.log(`  $${usd.toFixed(2)} on ${MODEL}`);
