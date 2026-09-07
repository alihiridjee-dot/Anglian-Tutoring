import { createServerFn } from "@tanstack/react-start";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { callWithBackoff, claimRequest } from "@/lib/ai/throttle";

// Explicit student requests are mapped to curriculum points here.
// Automatic weekly assignments are owned by ProgramDAL and FSRS.

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

/** Load the course catalogue without historical confidence ratings. */
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

  const { data: points, error: pErr } = await supabase
    .from("spec_points")
    .select("id, code, title, topic_id, sort_order")
    .in("topic_id", topicIds);
  if (pErr) throw pErr;
  if (!points) return [];

  return points
    .map((p) => {
      const topic = topicById.get(p.topic_id);
      return {
        id: p.id,
        code: p.code,
        title: p.title,
        topic: topic?.title ?? null,
        topicSort: topic?.sort_order ?? 0,
        pointSort: p.sort_order ?? 0,
      };
    })
    .sort(
      (a, b) =>
        a.topicSort - b.topicSort || a.pointSort - b.pointSort || a.code.localeCompare(b.code),
    );
}

function courseCatalogue(candidates: Candidate[]): string {
  return candidates.map((c, i) => `[${i}] ${c.topic ?? "—"} · ${c.code} ${c.title}`).join("\n");
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
    await claimRequest(supabase, "interpret-weakness");

    const candidates = await loadCandidates(supabase, data.subject, data.board, data.level);
    if (candidates.length === 0) return { specPointIds: [] as string[], count: 0 };

    // The catalogue is shared across every
    // student on this course, so it goes in a cached block and only the
    // student's own words ride in the user turn.
    const system: Anthropic.TextBlockParam[] = [
      {
        type: "text",
        text: `A UK ${data.level.toUpperCase()} ${data.subject} student describes what they find difficult, in their own words.
Here is every spec point in their course, numbered:
${courseCatalogue(candidates)}`,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: `Match what they say to the spec points it refers to. Be precise, not generous — pick the points genuinely implied, not a whole topic because one word overlapped. If nothing matches, return an empty list.
Return ONLY JSON, no prose, no markdown fences:
{"indices":[3,4,5]}`,
      },
    ];

    let res;
    try {
      res = await callWithBackoff(() =>
        client().messages.create({
          model: MODEL,
          max_tokens: 800,
          system,
          messages: [{ role: "user", content: `Student says:\n${data.text}` }],
        }),
      );
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
