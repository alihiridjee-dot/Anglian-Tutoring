import { createServerFn } from "@tanstack/react-start";
import Anthropic from "@anthropic-ai/sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SUBJECTS, LEVELS, BOARDS } from "@/lib/taxonomy";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Drafting the written questions that make up a built-in homework.
 *
 * Unlike the MCQ generators this writes nothing to the database: it hands the
 * draft back to the tutor, who edits, re-marks or deletes questions in the form
 * and only then sets the homework. That keeps a half-reviewed, AI-written brief
 * from ever being visible to a student, and avoids needing a draft state on
 * `resources`.
 */

const MODEL = "claude-sonnet-5";

export type DraftQuestion = {
  prompt: string;
  marks: number;
  answer_type: "short" | "long" | "numeric";
  mark_scheme: string;
  spec_point_id: string | null;
};

type RawQuestion = {
  prompt?: string;
  marks?: number;
  answer_type?: string;
  mark_scheme?: string;
};

const ANSWER_TYPES = new Set(["short", "long", "numeric"]);

// Claude occasionally wraps JSON in ```json fences despite instructions.
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

type SupabaseServer = SupabaseClient<Database>;

async function requireTutor(supabase: SupabaseServer, userId: string) {
  const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = ((role ?? []) as Array<{ role: string }>).map((r) => r.role);
  if (!roles.includes("tutor")) throw new Error("Tutor access required");
}

async function askClaude(system: string, user: string): Promise<RawQuestion[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const client = new Anthropic({ apiKey });

  let res;
  try {
    res = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
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

  let parsed: { questions?: RawQuestion[] };
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    throw new Error("AI returned invalid JSON");
  }
  const qs = Array.isArray(parsed.questions) ? parsed.questions : [];
  if (qs.length === 0) throw new Error("No questions generated");
  return qs;
}

/** Coerce whatever the model returned into something the form can safely render. */
function toDrafts(raw: RawQuestion[], specPointId: string | null, limit: number): DraftQuestion[] {
  return raw
    .filter((q) => typeof q?.prompt === "string" && q.prompt.trim().length > 0)
    .slice(0, limit)
    .map((q) => ({
      prompt: String(q.prompt).trim(),
      marks: Math.min(Math.max(Math.round(Number(q.marks) || 2), 1), 30),
      answer_type: (ANSWER_TYPES.has(String(q.answer_type))
        ? String(q.answer_type)
        : "short") as DraftQuestion["answer_type"],
      mark_scheme: typeof q.mark_scheme === "string" ? q.mark_scheme.trim() : "",
      spec_point_id: specPointId,
    }));
}

function systemPrompt(count: number, level: string, board: string, subject: string): string {
  return `You are an experienced UK ${board.toUpperCase()} ${level.toUpperCase()} ${subject} teacher writing a homework worksheet.
Write exactly ${count} exam-style written questions on the spec point below.
Rules:
- Questions are answered by typing into a text box, so never write "draw", "sketch", "plot" or anything needing a diagram from the student — they can attach a photo, but the question itself must stand on typed text.
- Use real exam command words (state, describe, explain, calculate, compare, evaluate) and build up in difficulty.
- Award marks realistically: 1–2 for recall, 3–4 for explanation, 5–6 for extended reasoning.
- answer_type is "short" for one-line recall, "numeric" for a calculated value, "long" for anything needing several sentences.
- mark_scheme lists the credit-worthy points, one per line, as a real mark scheme would.
Return ONLY JSON in this exact shape — no prose, no markdown fences:
{"questions":[{"prompt":"...","marks":3,"answer_type":"long","mark_scheme":"..."}]}`;
}

type GenInput = {
  specPointIds: string[];
  subject: string;
  board: string;
  level: string;
  count: number;
  /** Free-text steer from the tutor, e.g. "focus on required practical 4". */
  notes?: string;
};

/**
 * Draft a homework's questions across the spec points the tutor picked.
 *
 * The requested count is spread over the selected points (at least one each), so
 * a homework covering three points comes back balanced rather than dwelling on
 * whichever point happened to be first. Each draft carries its spec point id, so
 * the questions stay tagged for the curriculum browser once saved.
 */
export const generateHomeworkQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: GenInput) => {
    const ids = Array.isArray(input?.specPointIds)
      ? input.specPointIds.map(String).filter(Boolean)
      : [];
    if (ids.length === 0) throw new Error("Select at least one spec point first");
    const subject = SUBJECTS.find((s) => s.value === input?.subject)?.value;
    if (!subject) throw new Error("subject required");
    const level = LEVELS.find((l) => l.value === input?.level)?.value;
    if (!level) throw new Error("level required");
    const board = BOARDS.find((b) => b.value === input?.board)?.value;
    if (!board) throw new Error("board required");
    return {
      specPointIds: ids.slice(0, 8),
      subject,
      board,
      level,
      count: Math.min(Math.max(Number(input?.count) || 5, 1), 20),
      notes: String(input?.notes ?? "").slice(0, 500),
    };
  })
  .handler(async ({ data, context }): Promise<{ questions: DraftQuestion[] }> => {
    const { supabase, userId } = context;
    await requireTutor(supabase, userId);

    const { data: pointRows, error: pointErr } = await supabase
      .from("spec_points")
      .select("id, title, description")
      .in("id", data.specPointIds);
    if (pointErr) throw pointErr;

    const points = (
      (pointRows ?? []) as Array<{
        id: string;
        title: string;
        description: string | null;
      }>
    ).filter((p) => !!p?.id);
    if (points.length === 0) throw new Error("No matching spec points found");

    // Spread the requested total across the points, remainder to the first ones.
    const base = Math.floor(data.count / points.length);
    const remainder = data.count - base * points.length;
    const counts = points.map((_, i) => Math.max(1, base + (i < remainder ? 1 : 0)));

    const drafts: DraftQuestion[] = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const raw = await askClaude(
        systemPrompt(counts[i], data.level, data.board, data.subject),
        `Spec point: ${p.title}\n\nDetails:\n${
          p.description || "(no additional detail — infer from the title)"
        }${data.notes ? `\n\nTutor's steer: ${data.notes}` : ""}`,
      );
      drafts.push(...toDrafts(raw, p.id, counts[i]));
    }

    if (drafts.length === 0) throw new Error("No usable questions came back — try again");
    return { questions: drafts };
  });
