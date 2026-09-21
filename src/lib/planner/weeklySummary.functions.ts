import { createServerFn } from "@tanstack/react-start";
import Anthropic from "@anthropic-ai/sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// The student-facing "what you'll focus on this week" summary is generated ONCE
// when the tutor saves a week's spec points, and persisted on the weekly_focus
// row (ai_summary). Students then just read the stored text — no per-view AI
// call. Runs through Anthropic Claude, mirroring the MCQ generator's setup.

const MODEL = "claude-sonnet-5";
// Cheap, fast and more than strong enough for a two-sentence overview.

type PointRow = {
  spec_points: {
    code: string;
    title: string;
    sort_order: number | null;
    topics: { code: string | null; title: string; sort_order: number | null } | null;
  } | null;
};

type FocusRow = {
  id: string;
  subject: string;
  board: string;
  level: string;
  weekly_focus_points: PointRow[] | null;
};

async function generateSummary(focus: FocusRow): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const client = new Anthropic({ apiKey });

  const points = (focus.weekly_focus_points ?? [])
    .map((wp) => wp.spec_points)
    .filter((sp): sp is NonNullable<typeof sp> => !!sp)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.code.localeCompare(b.code));

  const pointList = points
    .map((p) => {
      const topic = p.topics
        ? p.topics.code
          ? `${p.topics.code} · ${p.topics.title}`
          : p.topics.title
        : "";
      return `- ${p.code} ${p.title}${topic ? ` (${topic})` : ""}`;
    })
    .join("\n");

  const system = `You are a friendly UK ${focus.level.toUpperCase()} ${focus.subject} tutor writing a short "this week's focus" note for a student.
Write 2–3 sentences, warm and plain-English, explaining what the student will be learning and why it matters — no jargon dumps.
Address the student directly ("you'll..."). Do not list the spec-point codes back. Return ONLY the summary text, no preamble, no markdown.`;

  const user = `Subject: ${focus.subject} · ${focus.level}${focus.board ? ` · ${focus.board.toUpperCase()}` : ""}
This week's spec points:
${pointList}`;

  let res;
  try {
    res = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: user }],
    });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status === 429) throw new Error("AI rate limit — try again in a moment");
    if (status === 402) throw new Error("AI credits exhausted — top up in workspace billing");
    throw new Error(`AI error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * Regenerate and persist the AI focus summary for one weekly_focus row. Called
 * by the tutor editor right after the plan's points are saved, so the summary is
 * produced exactly once per edit and stored on the row for students to read.
 * Best-effort: the caller treats a thrown error as non-fatal (the plan is still
 * saved; the student card just falls back to the spec-point list).
 */
export const refreshWeeklySummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { focusId: string }) => {
    if (!input?.focusId) throw new Error("focusId required");
    return { focusId: String(input.focusId) };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: row, error } = await supabase
      .from("weekly_focus")
      .select(
        "id, subject, board, level, weekly_focus_points(spec_points(code, title, sort_order, topics(code, title, sort_order)))",
      )
      .eq("id", data.focusId)
      .single();
    if (error) throw error;

    const summary = await generateSummary(row as FocusRow);
    if (!summary) throw new Error("No summary generated");

    const { error: updErr } = await supabase
      .from("weekly_focus")
      .update({ ai_summary: summary })
      .eq("id", data.focusId);
    if (updErr) throw updErr;

    return { summary };
  });
