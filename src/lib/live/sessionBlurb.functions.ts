import { createServerFn } from "@tanstack/react-start";
import Anthropic from "@anthropic-ai/sdk";
import { NOTATION_RULE, NO_THINKING, completeText } from "@/lib/platform/aiText";
import { toSciNotation } from "@/lib/platform/sciNotation";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTutorAi } from "@/lib/auth/tutorAi.server";

// Generates the friendly "in this session we'll talk about…" blurb the tutor can
// drop into a live session's description. It runs in the tutor studio (not per
// student view): the tutor clicks generate, the text lands in the editable
// description field, and once the session is scheduled that same description is
// what the student sees on their countdown banner.

const MODEL = "claude-sonnet-5-5";

async function generateBlurb(input: {
  subject: string;
  level: string;
  board: string | null;
  title: string;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const client = new Anthropic({ apiKey });

  const system = `You are a friendly UK ${input.level.toUpperCase()} ${input.subject} tutor writing a one-line teaser for a live session, shown to a student on their dashboard.
Write ONE short, inviting sentence (max ~20 words) that says what the session will cover, addressed to the student ("we'll…" / "you'll…").
Warm and plain-English, no jargon dumps. ${NOTATION_RULE}
Return ONLY the sentence, no preamble, no markdown, no quotes.`;

  const user = `Session title: ${input.title || "(untitled)"}
Subject: ${input.subject} · ${input.level}${input.board ? ` · ${input.board.toUpperCase()}` : ""}`;

  let res;
  try {
    res = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      thinking: NO_THINKING,
      system,
      messages: [{ role: "user", content: user }],
    });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status === 429) throw new Error("AI rate limit — try again in a moment");
    if (status === 402) throw new Error("AI credits exhausted — top up in workspace billing");
    throw new Error(`AI error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return toSciNotation(completeText(res).trim());
}

/**
 * Draft a session description from its title, subject and level. The tutor
 * triggers this from the live-session form; the returned text is dropped into
 * the (still editable) description field.
 */
export const generateSessionBlurb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { subject: string; level: string; board?: string | null; title?: string }) => {
      if (!input?.subject || !input?.level) throw new Error("subject and level required");
      return {
        subject: String(input.subject).slice(0, 40),
        level: String(input.level).slice(0, 40),
        board: input.board ? String(input.board).slice(0, 40) : null,
        title: input.title ? String(input.title).slice(0, 200) : "",
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireTutorAi(supabase, userId, "session_blurb");

    const blurb = await generateBlurb({
      subject: data.subject,
      level: data.level,
      board: data.board,
      title: data.title,
    });
    if (!blurb) throw new Error("No blurb generated");

    return { blurb };
  });
