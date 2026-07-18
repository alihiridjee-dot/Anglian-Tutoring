import { createServerFn } from "@tanstack/react-start";
import Anthropic from "@anthropic-ai/sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BOARDS, type SubjectV, type LevelV } from "@/lib/taxonomy";

// AI spec-point suggester for live sessions. The tutor writes a session title +
// description ("Photosynthesis masterclass — light-dependent reactions, limiting
// factors…") and this proposes the curriculum spec points it covers, so they
// don't have to hunt through every board's topic tree by hand. Live sessions are
// board-agnostic broad themes, so candidates span ALL boards for the subject +
// level and the model may return the equivalent point under each board.
//
// Mirrors sessionBlurb/mcq function setup (Anthropic claude-sonnet-5, needs
// ANTHROPIC_API_KEY). Spec points are resolved server-side; the client only
// sends the free text and gets back the ids to tick.

const MODEL = "claude-sonnet-5";

const BOARD_RANK = new Map(BOARDS.map((b, i) => [b.value as string, i]));
const boardLabel = (b: string | null) =>
  (b && BOARDS.find((x) => x.value === b)?.label) || (b ? b.toUpperCase() : "Other");

type Candidate = {
  id: string;
  code: string;
  title: string;
  board: string | null;
  topic: string | null;
};

// Claude occasionally wraps JSON in ```json fences despite instructions; strip
// them before parsing.
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

async function pickIndices(
  subject: string,
  level: string,
  title: string,
  description: string,
  candidates: Candidate[],
): Promise<number[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const client = new Anthropic({ apiKey });

  // Index each candidate so the model returns small integers, not fragile uuids.
  const list = candidates
    .map(
      (c, i) =>
        `[${i}] ${boardLabel(c.board)} · ${c.topic ?? "—"} · ${c.code} ${c.title}`,
    )
    .join("\n");

  const system = `You match a UK ${level.toUpperCase()} ${subject} live-session description to the curriculum spec points it covers.
You are given a numbered list of candidate spec points (across several exam boards) and a session title + description.
Select ONLY the spec points the session genuinely covers — be precise, not generous; a typical themed session maps to a handful of points, not dozens.
The session is board-agnostic, so when a topic appears under multiple boards and the session covers it, include the matching point under EACH relevant board.
If nothing genuinely matches, return an empty list.
Return ONLY JSON in this exact shape — no prose, no markdown fences:
{"indices":[0,4,5]}`;

  const user = `Session title: ${title || "(untitled)"}
Session description:
${description || "(no description — infer from the title)"}

Candidate spec points:
${list}`;

  let res;
  try {
    res = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content: user }],
    });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status === 429) throw new Error("AI rate limit — try again in a moment");
    if (status === 402) throw new Error("AI credits exhausted — top up in workspace billing");
    throw new Error(`AI error: ${e instanceof Error ? e.message : String(e)}`);
  }

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed: { indices?: unknown };
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    throw new Error("AI returned an unreadable response — try again");
  }

  const raw = Array.isArray(parsed.indices) ? parsed.indices : [];
  // Keep only valid, in-range, de-duplicated indices.
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of raw) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n < candidates.length && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * Suggest the spec points a live session covers from its title + description.
 * Loads every candidate point for the subject + level (all boards), asks the
 * model which apply, and returns their ids for the form to tick. Read-only — it
 * never writes anything; the tutor confirms the selection before scheduling.
 */
export const suggestSpecPoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { subject: string; level: string; title?: string; description?: string }) => {
      if (!input?.subject || !input?.level) throw new Error("subject and level required");
      return {
        subject: String(input.subject),
        level: String(input.level),
        title: input.title ? String(input.title) : "",
        description: input.description ? String(input.description) : "",
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    if (!data.title && !data.description) {
      throw new Error("Add a title or description first so the AI has something to match.");
    }

    const { data: rows, error } = await supabase
      .from("spec_points")
      .select("id, code, title, topics!inner(title, board, sort_order, subject, level)")
      .eq("topics.subject", data.subject as SubjectV)
      .eq("topics.level", data.level as LevelV);
    if (error) throw error;

    type SpecRow = {
      id: string;
      code: string;
      title: string;
      topics: { title: string | null; board: string | null; sort_order: number | null } | null;
    };

    const candidates: Candidate[] = ((rows ?? []) as unknown as SpecRow[])
      .map((r) => ({
        id: r.id,
        code: r.code,
        title: r.title,
        board: r.topics?.board ?? null,
        topic: r.topics?.title ?? null,
        _topicSort: r.topics?.sort_order ?? 0,
      }))
      // Stable order (Edexcel → AQA → OCR, then topic order, then code) so the
      // indices the model sees are deterministic.
      .sort(
        (a, b) =>
          (BOARD_RANK.get(a.board ?? "") ?? 99) - (BOARD_RANK.get(b.board ?? "") ?? 99) ||
          a._topicSort - b._topicSort ||
          a.code.localeCompare(b.code),
      )
      .map(({ _topicSort, ...c }) => c);

    if (candidates.length === 0) {
      return { specPointIds: [] as string[], count: 0 };
    }

    const indices = await pickIndices(
      data.subject,
      data.level,
      data.title,
      data.description,
      candidates,
    );
    const specPointIds = indices.map((i) => candidates[i].id);

    return { specPointIds, count: specPointIds.length };
  });
