import { createServerFn } from "@tanstack/react-start";
import Anthropic from "@anthropic-ai/sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Generates the friendly "in this session we'll talk about…" blurb the tutor can
// drop into a live session's description. It runs in the tutor studio (not per
// student view): the tutor clicks generate, the text lands in the editable
// description field, and once the session is scheduled that same description is
// what the student sees on their countdown banner. Mirrors weeklySummary's setup.

const MODEL = "claude-sonnet-5";

type SpecPoint = { code: string; title: string };

async function generateBlurb(input: {
  subject: string;
  level: string;
  board: string | null;
  title: string;
  points: SpecPoint[];
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const client = new Anthropic({ apiKey });

  const pointList = input.points.map((p) => `- ${p.code} ${p.title}`).join("\n");

  const system = `You are a friendly UK ${input.level.toUpperCase()} ${input.subject} tutor writing a one-line teaser for a live session, shown to a student on their dashboard.
Write ONE short, inviting sentence (max ~20 words) that says what the session will cover, addressed to the student ("we'll…" / "you'll…").
Warm and plain-English, no jargon dumps, do not list spec-point codes back. Return ONLY the sentence, no preamble, no markdown, no quotes.`;

  const user = `Session title: ${input.title || "(untitled)"}
Subject: ${input.subject} · ${input.level}${input.board ? ` · ${input.board.toUpperCase()}` : ""}
Spec points covered:
${pointList || "(none tagged yet — base it on the title)"}`;

  let res;
  try {
    res = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
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
 * Draft a session description from its title + tagged spec points. The tutor
 * triggers this from the live-session form; the returned text is dropped into
 * the (still editable) description field. We resolve the spec-point codes/titles
 * server-side from their ids so the client only sends ids it already holds.
 */
export const generateSessionBlurb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      subject: string;
      level: string;
      board?: string | null;
      title?: string;
      specPointIds: string[];
    }) => {
      if (!input?.subject || !input?.level) throw new Error("subject and level required");
      return {
        subject: String(input.subject),
        level: String(input.level),
        board: input.board ? String(input.board) : null,
        title: input.title ? String(input.title) : "",
        specPointIds: Array.isArray(input.specPointIds) ? input.specPointIds.map(String) : [],
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    let points: SpecPoint[] = [];
    if (data.specPointIds.length > 0) {
      const { data: rows, error } = await supabase
        .from("spec_points")
        .select("code, title")
        .in("id", data.specPointIds);
      if (error) throw error;
      points = (rows ?? []) as SpecPoint[];
    }

    const blurb = await generateBlurb({
      subject: data.subject,
      level: data.level,
      board: data.board,
      title: data.title,
      points,
    });
    if (!blurb) throw new Error("No blurb generated");

    return { blurb };
  });
