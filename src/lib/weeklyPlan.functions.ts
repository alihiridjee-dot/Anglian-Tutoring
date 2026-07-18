import { createServerFn } from "@tanstack/react-start";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";

// AI for the personalized planner. Two read-only suggesters, both mirroring the
// suggestSpecPoints setup (Anthropic claude-sonnet-5, ANTHROPIC_API_KEY, server-
// side id resolution so the client only ever exchanges free text + spec-point
// ids):
//
//   • suggestWeeklyPlan — from the student's own confidence across the topic
//     tree (+ optional free-text focus), pick the handful of spec points to
//     cover THIS week, weakest-first but coherent, with a one-line rationale.
//   • interpretWeakness — map a free-text "what I struggle with" to the spec
//     points it refers to, so the student can seed a plan by describing it.
//
// Neither writes anything: the client confirms the selection and the planner DAL
// persists the weekly plan. Scoped to one subject/board/level (the student's
// enrolment), so candidates are that course's spec points only.

const MODEL = "claude-sonnet-5";

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

type Candidate = {
  id: string;
  code: string;
  title: string;
  topic: string | null;
  topicSort: number;
  pointSort: number;
  /** 0-100, or null when the student hasn't rated it. */
  confidence: number | null;
};

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey });
}

function mapAnthropicError(e: unknown): Error {
  const status = (e as { status?: number })?.status;
  if (status === 429) return new Error("AI rate limit — try again in a moment");
  if (status === 402) return new Error("AI credits exhausted — top up in workspace billing");
  return new Error(`AI error: ${e instanceof Error ? e.message : String(e)}`);
}

/**
 * Loads every spec point for a course, merged with the caller's confidence.
 * Effective confidence for a point is its own rating, else the topic's rating,
 * else null (never rated). Ordered by topic then point so candidate indices are
 * deterministic. RLS: `context.supabase` is the caller, so the confidence rows
 * it reads are the caller's own.
 */
async function loadCandidates(
  supabase: SupabaseClient<Database>,
  subject: SubjectV,
  board: BoardV,
  level: LevelV,
): Promise<Candidate[]> {
  const { data: topics, error: tErr } = await supabase
    .from("topics")
    .select("id, title, sort_order")
    .eq("subject", subject)
    .eq("board", board)
    .eq("level", level);
  if (tErr) throw tErr;
  if (!topics || topics.length === 0) return [];

  const topicById = new Map(topics.map((t) => [t.id, t]));
  const topicIds = topics.map((t) => t.id);

  const [{ data: points, error: pErr }, { data: topicConf }, { data: specConf }] =
    await Promise.all([
      supabase
        .from("spec_points")
        .select("id, code, title, topic_id, sort_order")
        .in("topic_id", topicIds),
      supabase
        .from("student_topic_confidence")
        .select("topic_id, confidence")
        .in("topic_id", topicIds),
      supabase.from("student_spec_point_confidence").select("spec_point_id, confidence"),
    ]);
  if (pErr) throw pErr;
  if (!points) return [];

  const topicConfById = new Map((topicConf ?? []).map((r) => [r.topic_id, r.confidence]));
  const specConfById = new Map((specConf ?? []).map((r) => [r.spec_point_id, r.confidence]));

  return points
    .map((p) => {
      const topic = topicById.get(p.topic_id);
      const conf = specConfById.has(p.id)
        ? (specConfById.get(p.id) as number)
        : topicConfById.has(p.topic_id)
          ? (topicConfById.get(p.topic_id) as number)
          : null;
      return {
        id: p.id,
        code: p.code,
        title: p.title,
        topic: topic?.title ?? null,
        topicSort: topic?.sort_order ?? 0,
        pointSort: p.sort_order ?? 0,
        confidence: conf,
      };
    })
    .sort(
      (a, b) =>
        a.topicSort - b.topicSort || a.pointSort - b.pointSort || a.code.localeCompare(b.code),
    );
}

function confLabel(c: number | null): string {
  if (c == null) return "not rated";
  if (c >= 67) return `confident (${c})`;
  if (c >= 34) return `getting there (${c})`;
  return `needs work (${c})`;
}

function parseIndices(text: string, max: number): number[] {
  let parsed: { indices?: unknown };
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    throw new Error("AI returned an unreadable response — try again");
  }
  const raw = Array.isArray(parsed.indices) ? parsed.indices : [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of raw) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n < max && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function parseRationale(text: string): string {
  try {
    const parsed = JSON.parse(stripFences(text)) as { rationale?: unknown };
    return typeof parsed.rationale === "string" ? parsed.rationale : "";
  } catch {
    return "";
  }
}

/**
 * Suggest the spec points to cover this week from the student's confidence
 * (plus an optional free-text focus). Returns their ids + a short rationale; the
 * client turns that into an editable weekly plan. Read-only.
 */
export const suggestWeeklyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      subject: string;
      board: string;
      level: string;
      focus?: string;
      targetCount?: number;
    }) => {
      if (!input?.subject || !input?.board || !input?.level)
        throw new Error("subject, board and level required");
      return {
        subject: String(input.subject) as SubjectV,
        board: String(input.board) as BoardV,
        level: String(input.level) as LevelV,
        focus: input.focus ? String(input.focus).slice(0, 1000) : "",
        targetCount: Math.min(Math.max(Number(input.targetCount) || 6, 3), 10),
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const candidates = await loadCandidates(supabase, data.subject, data.board, data.level);
    if (candidates.length === 0) return { specPointIds: [] as string[], rationale: "", count: 0 };

    const list = candidates
      .map((c, i) => `[${i}] ${c.topic ?? "—"} · ${c.code} ${c.title} — ${confLabel(c.confidence)}`)
      .join("\n");

    const system = `You are planning one week of revision for a UK ${data.level.toUpperCase()} ${data.subject} student.
You get a numbered list of every spec point in their course, each tagged with how confident the student feels (or "not rated").
Choose about ${data.targetCount} spec points for THIS week. Lead with the weakest ("needs work"), then "getting there"; include a "not rated" point only if it fits the theme. Keep the set coherent — points from the same topic that build on each other are better than a scattergun across the whole spec.
${data.focus ? `The student specifically wants to focus on: "${data.focus}". Weight the selection toward that.` : ""}
Return ONLY JSON, no prose, no markdown fences:
{"indices":[3,4,5],"rationale":"one short sentence, addressed to the student, on why these"}`;

    let res;
    try {
      res = await client().messages.create({
        model: MODEL,
        max_tokens: 1000,
        system,
        messages: [{ role: "user", content: `Spec points:\n${list}` }],
      });
    } catch (e) {
      throw mapAnthropicError(e);
    }

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const indices = parseIndices(text, candidates.length);
    return {
      specPointIds: indices.map((i) => candidates[i].id),
      rationale: parseRationale(text),
      count: indices.length,
    };
  });

/**
 * Map a free-text description of what a student struggles with to the spec
 * points it refers to, so they can seed a plan by describing it in their own
 * words. Read-only — returns ids for the client to add to a plan.
 */
export const interpretWeakness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { subject: string; board: string; level: string; text: string }) => {
    if (!input?.subject || !input?.board || !input?.level)
      throw new Error("subject, board and level required");
    if (!input?.text?.trim()) throw new Error("Describe what you're finding tricky first.");
    return {
      subject: String(input.subject) as SubjectV,
      board: String(input.board) as BoardV,
      level: String(input.level) as LevelV,
      text: String(input.text).slice(0, 1000),
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const candidates = await loadCandidates(supabase, data.subject, data.board, data.level);
    if (candidates.length === 0) return { specPointIds: [] as string[], count: 0 };

    const list = candidates
      .map((c, i) => `[${i}] ${c.topic ?? "—"} · ${c.code} ${c.title}`)
      .join("\n");

    const system = `A UK ${data.level.toUpperCase()} ${data.subject} student describes what they find difficult, in their own words.
Match it to the spec points it refers to from the numbered list. Be precise, not generous — pick the points genuinely implied, not a whole topic because one word overlapped. If nothing matches, return an empty list.
Return ONLY JSON, no prose, no markdown fences:
{"indices":[3,4,5]}`;

    let res;
    try {
      res = await client().messages.create({
        model: MODEL,
        max_tokens: 800,
        system,
        messages: [
          { role: "user", content: `Student says:\n${data.text}\n\nSpec points:\n${list}` },
        ],
      });
    } catch (e) {
      throw mapAnthropicError(e);
    }

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const indices = parseIndices(text, candidates.length);
    return { specPointIds: indices.map((i) => candidates[i].id), count: indices.length };
  });
