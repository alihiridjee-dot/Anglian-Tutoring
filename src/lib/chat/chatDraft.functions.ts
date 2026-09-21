import { createServerFn } from "@tanstack/react-start";
import Anthropic from "@anthropic-ai/sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Drafts a tutor's reply to a student's question.
 *
 * A DRAFT, never a send. The text lands in the tutor's editable reply box and
 * nothing leaves the building until they press send — a student asking their
 * tutor a question is entitled to an answer from their tutor, and an
 * auto-published one would quietly replace the relationship they're paying for.
 * The `ai_drafted` flag on the sent message records that it started here.
 *
 * Tutor-only, enforced server-side: the handler checks the caller's role before
 * spending a token, so a student cannot use this as a free question-answerer
 * (and cannot draft replies into their own thread).
 *
 * Mirrors the setup in sessionBlurb.functions.ts and mcq.functions.ts — the API
 * key exists only on the server.
 */

const MODEL = "claude-sonnet-5";

/** Enough of the conversation for a useful answer, without sending everything. */
const HISTORY_LIMIT = 12;

type Turn = { from: "student" | "tutor"; body: string };

async function draftReply(input: {
  studentName: string;
  level: string | null;
  board: string | null;
  subject: string | null;
  contextLabel: string | null;
  subjectLine: string;
  history: Turn[];
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const client = new Anthropic({ apiKey });

  const course = [input.level, input.board?.toUpperCase(), input.subject]
    .filter(Boolean)
    .join(" · ");

  const system = `You are drafting a reply that a UK science tutor will read, edit and send to their own student. You are not talking to the student directly.

Write as the tutor: warm, plain English, no jargon unless the spec uses it, and never condescending. Answer the actual question first, then at most one short follow-up prompt or next step.

Rules:
- Keep it under 120 words. This is a message, not a lesson.
- Be specific to the exam board and level given. If the answer depends on the board and you can't tell, say so in one clause rather than guessing.
- If you are not confident the answer is correct, say what you're unsure about instead of inventing detail — the tutor is checking this and a confident wrong answer costs them more time than a blank.
- No greeting line and no sign-off; the tutor adds those.
- Return ONLY the message body. No preamble, no markdown headings, no quotes.`;

  const conversation = input.history
    .map((t) => `${t.from === "student" ? "STUDENT" : "TUTOR"}: ${t.body}`)
    .join("\n\n");

  const user = `Student: ${input.studentName}
Course: ${course || "(not recorded)"}
Question is about: ${input.contextLabel ?? "(no specific spec point, homework or quiz attached)"}
Thread subject: ${input.subjectLine}

Conversation so far:
${conversation}

Draft the tutor's next reply.`;

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

export const generateChatDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { threadId: string }) => {
    if (!input?.threadId) throw new Error("threadId required");
    return { threadId: String(input.threadId) };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Tutor-only. Checked here rather than trusted from the client: this spends
    // credits and reads a whole conversation.
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r) => r.role === "tutor")) {
      throw new Error("Only tutors can draft replies.");
    }

    // RLS still applies to this client, so a thread the caller can't see simply
    // isn't found — the role check above is the authorisation, this is the fetch.
    const { data: thread, error: threadErr } = await supabase
      .from("chat_threads")
      .select("id, student_id, subject, subject_line, context_label")
      .eq("id", data.threadId)
      .maybeSingle();
    if (threadErr) throw threadErr;
    if (!thread) throw new Error("Thread not found.");

    const [{ data: messages }, { data: profile }, { data: enrolment }] = await Promise.all([
      supabase
        .from("chat_messages")
        .select("sender_id, body, created_at")
        .eq("thread_id", data.threadId)
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT),
      supabase
        .from("profiles")
        .select("display_name, level")
        .eq("id", thread.student_id)
        .maybeSingle(),
      supabase
        .from("student_enrolments")
        .select("board")
        .eq("student_id", thread.student_id)
        .limit(1)
        .maybeSingle(),
    ]);

    const history: Turn[] = (messages ?? [])
      .slice()
      .reverse()
      .map((m) => ({
        from: m.sender_id === thread.student_id ? "student" : "tutor",
        body: m.body,
      }));
    if (history.length === 0) throw new Error("Nothing to reply to yet.");

    const draft = await draftReply({
      studentName: profile?.display_name?.trim() || "the student",
      level: profile?.level ?? null,
      board: enrolment?.board ?? null,
      subject: thread.subject,
      contextLabel: thread.context_label,
      subjectLine: thread.subject_line,
      history,
    });
    if (!draft) throw new Error("No draft generated");

    return { draft };
  });
