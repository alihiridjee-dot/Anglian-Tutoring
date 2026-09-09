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
- Questions are answered by typing into a text box and nothing can be uploaded, so never write "draw", "sketch", "plot" or anything the student would have to hand in as an image. Every answer must be fully expressible as typed text.
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

/** Questions written per spec point when the planner fills a gap itself. */
const QUESTIONS_PER_POINT = 5;

/**
 * Generations one student may trigger per hour, counted in the database
 * (`claim_ai_request`) rather than in memory, so the budget survives a
 * serverless instance going away mid-week.
 *
 * A week is three to six points, so this covers a couple of weeks of genuine
 * filling-in and then stops. It is a spend cap, not a correctness guard — the
 * unique index is what keeps two students from paying for the same sheet.
 */
const GENERATIONS_PER_HOUR = 12;

type EnsureInput = {
  specPointIds: string[];
  subject: string;
  board: string;
  level: string;
};

export interface EnsureHomeworkResult {
  /** Sheets written by this call. */
  created: number;
  /** Points that already had one — the cheap, normal case. */
  existing: number;
  /** True when the hourly budget ran out before every gap was filled. */
  throttled: boolean;
}

/**
 * Fill in the homework for a week's spec points, writing anything missing.
 *
 * Homework is attached one-per-spec-point, which makes it *library* content
 * rather than per-student work: the sheet for "4.1.1.1 Eukaryotes and
 * prokaryotes" is written once and read by every student who ever reaches that
 * point. So this is called at planning time, fills only the gaps, and on every
 * subsequent week costs one indexed lookup and nothing else.
 *
 * It writes through `ensure_generated_homework` because setting homework needs
 * the tutor role and the caller here is the student whose week needs it. That
 * function is also the concurrency guard: two students reaching the same point
 * in the same minute both generate, and the partial unique index means the
 * second one's insert loses and returns the winner's sheet. Wasted tokens, not
 * a duplicate.
 *
 * Failures are deliberately soft. A week that renders without homework is a
 * week missing a chip; a week that fails to render because the model was slow
 * is a broken dashboard, and the planner is the more important of the two.
 */
export const ensureHomeworkForPoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: EnsureInput) => {
    const ids = Array.isArray(input?.specPointIds)
      ? [...new Set(input.specPointIds.map(String).filter(Boolean))]
      : [];
    if (ids.length === 0) throw new Error("No spec points given");
    const subject = SUBJECTS.find((s) => s.value === input?.subject)?.value;
    if (!subject) throw new Error("subject required");
    const level = LEVELS.find((l) => l.value === input?.level)?.value;
    if (!level) throw new Error("level required");
    const board = BOARDS.find((b) => b.value === input?.board)?.value ?? null;
    // A week is a handful of points; the cap is what stops a hand-rolled
    // request asking for the whole specification in one call.
    return { specPointIds: ids.slice(0, 12), subject, board, level };
  })
  .handler(async ({ data, context }): Promise<EnsureHomeworkResult> => {
    const { supabase } = context;

    const { data: already, error: haveErr } = await supabase
      .from("resources")
      .select("spec_point_id")
      .eq("kind", "homework")
      .in("spec_point_id", data.specPointIds);
    if (haveErr) throw haveErr;

    const have = new Set((already ?? []).map((r) => r.spec_point_id).filter(Boolean));
    const missing = data.specPointIds.filter((id) => !have.has(id));
    if (missing.length === 0) {
      return { created: 0, existing: data.specPointIds.length, throttled: false };
    }

    const { data: pointRows, error: pointErr } = await supabase
      .from("spec_points")
      .select("id, code, title, description")
      .in("id", missing);
    if (pointErr) throw pointErr;

    const points = (
      (pointRows ?? []) as Array<{
        id: string;
        code: string;
        title: string;
        description: string | null;
      }>
    ).filter((p) => !!p?.id);

    let created = 0;
    let throttled = false;

    for (const p of points) {
      // Claimed per sheet rather than per call, so a batch that runs out of
      // budget still keeps whatever it managed to write.
      const { data: allowed, error: limitErr } = await supabase.rpc("claim_ai_request", {
        _endpoint: "homework_generation",
        _limit: GENERATIONS_PER_HOUR,
        _window: "01:00:00",
      });
      if (limitErr || !allowed) {
        throttled = true;
        break;
      }

      try {
        const raw = await askClaude(
          systemPrompt(QUESTIONS_PER_POINT, data.level, data.board ?? "aqa", data.subject),
          `Spec point: ${p.code} ${p.title}\n\nDetails:\n${
            p.description || "(no additional detail — infer from the title)"
          }`,
        );
        const questions = toDrafts(raw, p.id, QUESTIONS_PER_POINT);
        if (questions.length === 0) continue;

        const { error: writeErr } = await supabase.rpc("ensure_generated_homework", {
          _spec_point_id: p.id,
          _title: `${p.code} ${p.title}`,
          _subject: data.subject,
          _level: data.level,
          _board: data.board ?? undefined,
          _questions: questions.map((q) => ({
            prompt: q.prompt,
            marks: q.marks,
            answer_type: q.answer_type,
            mark_scheme: q.mark_scheme,
          })),
        });
        if (writeErr) throw writeErr;
        created++;
      } catch (err) {
        // One bad spec point must not cost the rest of the week its homework.
        console.error(`[homework] generation failed for ${p.code}:`, err);
      }
    }

    return { created, existing: have.size, throttled };
  });
