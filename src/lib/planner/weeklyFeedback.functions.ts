import { createServerFn } from "@tanstack/react-start";
import Anthropic from "@anthropic-ai/sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// AI-assisted end-of-week feedback for the tutor's planner. The tutor clicks
// "Draft with AI"; this pulls together the student's real performance on the
// week's spec points (homework + MCQ marks, already computed client-side into
// coverage) plus their own check-in, and asks Claude to draft the note the tutor
// would write — what went well, what's still shaky, and what to focus on next.
//
// Read-only: it never writes anything. The tutor edits the draft and the
// existing "Save note" is the approve/publish step (student-visible via RLS).
// Metrics come in as input rather than being re-queried server-side because the
// coverage mapping (mapAttemptSources) is bound to the browser Supabase client;
// the tutor already sees these numbers, so trusting the payload is fine for a
// text-only generation. Mirrors the suggestSpecPoints / weeklySummary setup
// (Anthropic claude-sonnet-5, needs ANTHROPIC_API_KEY).

const MODEL = "claude-sonnet-5";

type PointMetric = {
  code: string;
  title: string;
  topic: string | null;
  /** "strong" | "practised" | "weak" | "not_done" — from planner/coverage. */
  status: string;
  /** Best homework mark on this point, or null. */
  homeworkScore: number | null;
  /** Best quiz mark on this point, or null. */
  quizScore: number | null;
};

const STATUS_WORD: Record<string, string> = {
  strong: "nailed it",
  practised: "practised (no score yet)",
  weak: "shaky",
  not_done: "not done",
};

function pct(n: number | null): string {
  return n == null ? "—" : `${n}%`;
}

async function generate(input: {
  subject: string;
  level: string;
  board: string;
  weekLabel: string;
  mode: "reply" | "general";
  studentReflection: string | null;
  studentFeltReady: boolean | null;
  points: PointMetric[];
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const client = new Anthropic({ apiKey });

  const pointList =
    input.points.length === 0
      ? "(no spec points were planned for this week)"
      : input.points
          .map((p) => {
            const topic = p.topic ? ` [${p.topic}]` : "";
            const word = STATUS_WORD[p.status] ?? p.status;
            return `- ${p.code} ${p.title}${topic} — ${word}; homework ${pct(
              p.homeworkScore,
            )}, quiz ${pct(p.quizScore)}`;
          })
          .join("\n");

  const checkinLine =
    input.studentFeltReady == null
      ? "The student has not completed a check-in for this week."
      : `The student's own check-in: they ${
          input.studentFeltReady ? "felt confident and ready to move on" : "wanted more practice"
        }${input.studentReflection ? `, and wrote: "${input.studentReflection}"` : "."}`;

  const replyClause =
    input.mode === "reply" && input.studentReflection
      ? "\nOpen by responding directly and warmly to what the student wrote in their check-in, then give your view."
      : "";

  const system = `You are a friendly, encouraging UK ${input.level.toUpperCase()} ${input.subject} tutor writing a short end-of-week feedback note that the STUDENT will read (${input.board ? `${input.board.toUpperCase()} board` : "their board"}).
Base it on the evidence given — the spec points covered this week with their homework/MCQ marks, and the student's own check-in.
Write 3–5 sentences of warm, plain-English prose. Do: name what went well and cite the strong marks; flag what's still shaky; end with one concrete recommendation for what to focus on next week. Don't: dump spec-point codes back, use markdown, or invent marks that aren't in the evidence.${replyClause}
Return ONLY the note text — no preamble, no headings, no markdown.`;

  const user = `Week: ${input.weekLabel}
Subject: ${input.subject} · ${input.level}${input.board ? ` · ${input.board.toUpperCase()}` : ""}

This week's spec points and how the student did:
${pointList}

${checkinLine}`;

  let res;
  try {
    res = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
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
 * Draft the tutor's weekly feedback note from the student's performance metrics
 * and check-in. Read-only — returns the draft text for the tutor to edit and
 * approve; nothing is persisted here.
 */
export const draftWeeklyFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      subject: string;
      level: string;
      board?: string;
      weekLabel?: string;
      mode?: string;
      studentReflection?: string | null;
      studentFeltReady?: boolean | null;
      points?: PointMetric[];
    }) => {
      if (!input?.subject || !input?.level) throw new Error("subject and level required");
      const rawPoints = Array.isArray(input.points) ? input.points : [];
      const points: PointMetric[] = rawPoints.slice(0, 40).map((p) => ({
        code: String(p?.code ?? "").slice(0, 40),
        title: String(p?.title ?? "").slice(0, 200),
        topic: p?.topic ? String(p.topic).slice(0, 200) : null,
        status: String(p?.status ?? "not_done").slice(0, 20),
        homeworkScore:
          p?.homeworkScore == null ? null : Math.max(0, Math.min(100, Number(p.homeworkScore))),
        quizScore: p?.quizScore == null ? null : Math.max(0, Math.min(100, Number(p.quizScore))),
      }));
      return {
        subject: String(input.subject),
        level: String(input.level),
        board: input.board ? String(input.board) : "",
        weekLabel: input.weekLabel ? String(input.weekLabel).slice(0, 60) : "this week",
        mode: input.mode === "reply" ? ("reply" as const) : ("general" as const),
        studentReflection: input.studentReflection
          ? String(input.studentReflection).slice(0, 1000)
          : null,
        studentFeltReady:
          typeof input.studentFeltReady === "boolean" ? input.studentFeltReady : null,
        points,
      };
    },
  )
  .handler(async ({ data }) => {
    const feedback = await generate(data);
    if (!feedback) throw new Error("No feedback generated — try again");
    return { feedback };
  });
