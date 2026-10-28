// Supabase Edge Function: mark-homework
//
// The only thing in the system that can put a mark on a student's work without
// a tutor typing it.
//
// It lives here rather than in the app server for one reason: writing a mark
// requires the service role. `enforce_grading_privileges` rejects any write to
// the grading columns unless the caller is a tutor, an admin, or service_role,
// and `homework_answers` is tutor-only by RLS on top of that. Those guards are
// what stop a student POSTing themselves full marks, so the marker has to be
// somewhere the service key can live without also sitting in the web app —
// which here means the platform injecting it, and nobody's browser ever being
// one bug away from it.
//
// Nothing published here is visible yet. The marks are *staged* in
// `homework_ai_marks` with a `release_at` a short way out; a tutor confirming
// early or the scheduled publisher is what turns them into a grade. See the
// migration `20260909150000_homework_on_platform.sql`.
//
// Required function secrets (set with `supabase secrets set ...`):
//   ANTHROPIC_API_KEY
// Auto-injected by the platform:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
//
// Deploy:
//   supabase functions deploy mark-homework
//
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// `npm:` rather than esm.sh for this one. The esm.sh Deno build resolves the
// SDK's Node shims through `deno.land/std@0.177.1`, which no longer serves
// `node/stream/promises.ts` — the deploy fails at module resolution, before any
// of this code runs. The edge runtime speaks npm specifiers natively.
import Anthropic from "npm:@anthropic-ai/sdk@0.111.0";
import { corsHeaders, HttpError } from "../_shared/http.ts";
import {
  EFFORT,
  MODEL,
  RESPONSE_SCHEMA,
  SYSTEM,
  buildPrompt,
  stageMarks,
  type Answer,
  type Question,
  type StagedMark,
} from "./marker.ts";

// The prompt, schema and checks live in marker.ts so the regression script and
// the harness test run exactly what this function runs. Re-exported for
// anything that imported them from here.
export { asAnswerData, buildPrompt, stageMarks } from "./marker.ts";

/**
 * How long a tutor has to correct a mark before the student sees it.
 *
 * Half an hour is deliberately short. A day's delay costs the student the thing
 * that makes feedback work — reading it while they still remember what they
 * wrote — and only buys something if somebody actually looks inside the window.
 * At this length nobody realistically will, and that is the point: review moves
 * from being a gate to being a spot-check afterwards, which is what it honestly
 * was. The half hour that remains is a chance to catch a sheet marked while it
 * was obviously broken, not a review period.
 */
const REVIEW_WINDOW_MINUTES = 30;

/**
 * Marking budget per student per hour. One submission is one call regardless of
 * how many questions it holds, so this is generous for a person and tight for a
 * script.
 */
const MARKINGS_PER_HOUR = 30;

/**
 * How long after hand-in a student's own call may still start marking: the
 * page's RESTART_WINDOW_MS (src/lib/homework/startMarking.ts), held here too,
 * where the page can't be bypassed. Later, a paper the marker keeps failing on
 * waits for a tutor to mark it by hand in the marking queue. (A tutor's own
 * call is still let through, but nothing in the app makes one.)
 */
const STUDENT_RESTART_WINDOW_MS = 60 * 60 * 1000;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

/** Ask Claude to mark the paper. One call for the whole thing. */
async function mark(
  title: string,
  subject: string | null,
  questions: Question[],
  answers: Map<string, string | null>,
): Promise<ReturnType<typeof stageMarks>> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new HttpError(500, "ANTHROPIC_API_KEY is not configured");

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    // Thinking tokens count against this on Opus 5.5, and at high effort a
    // five-question paper can think for a while before it writes.
    max_tokens: 16000,
    system: SYSTEM,
    output_config: {
      effort: EFFORT,
      format: { type: "json_schema", schema: RESPONSE_SCHEMA },
    },
    messages: [{ role: "user", content: buildPrompt(title, subject, questions, answers) }],
  });

  if (response.stop_reason === "refusal") {
    throw new HttpError(502, "The marker declined to mark this submission");
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(502, "The marker returned something that was not JSON");
  }
  return stageMarks(questions, answers, parsed);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Set once this call has claimed the submission, so a failure can let it go.
  let claimed: string | null = null;
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) throw new HttpError(401, "Not signed in");

    const { submissionId } = (await req.json().catch(() => ({}))) as { submissionId?: string };
    if (!submissionId || typeof submissionId !== "string") {
      throw new HttpError(400, "A submissionId is required");
    }

    // Who is asking. Read under their own token so a forged id gets them
    // nowhere; the service-role client below is only used once we know.
    const asCaller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );
    const { data: auth } = await asCaller.auth.getUser();
    const callerId = auth?.user?.id;
    if (!callerId) throw new HttpError(401, "Not signed in");

    const { data: submission, error: subError } = await db
      .from("homework_submissions")
      .select("id, resource_id, student_id, graded_at, ai_marked_at, submitted_at")
      .eq("id", submissionId)
      .single();
    if (subError || !submission) throw new HttpError(404, "No such submission");

    // A tutor may re-run marking on someone's work; anyone else may only ask
    // for their own, and only for work that has not been marked already.
    if (submission.student_id !== callerId) {
      const { data: roles } = await db.from("user_roles").select("role").eq("user_id", callerId);
      const isStaff = (roles ?? []).some((r) => r.role === "tutor" || r.role === "admin");
      if (!isStaff) throw new HttpError(403, "That is not your submission");
    }

    if (submission.graded_at) {
      return json({ marked: false, reason: "already_graded" });
    }
    if (submission.ai_marked_at) {
      return json({ marked: false, reason: "already_marked" });
    }
    if (
      submission.student_id === callerId &&
      Date.now() - new Date(submission.submitted_at).getTime() >= STUDENT_RESTART_WINDOW_MS
    ) {
      return json({ marked: false, reason: "too_late" });
    }

    // One run per submission. Without the claim, a double tap or a retry passed
    // the checks above in parallel, and each paid for its own Opus call.
    const { data: won, error: claimError } = await db.rpc("claim_homework_marking", {
      _submission_id: submissionId,
    });
    if (claimError) throw new HttpError(500, "Could not claim the submission for marking");
    if (!won) return json({ marked: false, reason: "in_progress" });
    claimed = submissionId;

    // Budget is claimed under the caller's own token, so it counts against the
    // person who triggered it rather than against the server.
    const { data: allowed, error: limitError } = await asCaller.rpc("claim_ai_request", {
      _endpoint: "homework_marking",
      _limit: MARKINGS_PER_HOUR,
      _window: "01:00:00",
    });
    if (limitError || !allowed) throw new HttpError(429, "Marking budget reached — try later");

    const [resourceRes, questionsRes, answersRes] = await Promise.all([
      db.from("resources").select("title, subject").eq("id", submission.resource_id).single(),
      db
        .from("homework_questions")
        .select("id, position, prompt, marks, answer_type, mark_scheme")
        .eq("resource_id", submission.resource_id)
        .order("position", { ascending: true }),
      db
        .from("homework_answers")
        .select("question_id, answer_text")
        .eq("submission_id", submissionId),
    ]);
    // A failed read is a failure, not an empty paper: read as "no answers", it
    // sent every answer to the model as "(left blank)" and published 0%.
    if (resourceRes.error || questionsRes.error || answersRes.error) {
      throw new HttpError(500, "Could not read the submission to mark it");
    }
    const resource = resourceRes.data;

    const questionRows = (questionsRes.data ?? []) as Question[];
    if (questionRows.length === 0) {
      // A brief with no questions has nothing to mark. Leaving it unstaged puts
      // it in the tutor's queue, which is the right place for it.
      await release(submissionId);
      return json({ marked: false, reason: "no_questions" });
    }

    const answerMap = new Map<string, string | null>(
      ((answersRes.data ?? []) as Answer[]).map((a) => [a.question_id, a.answer_text]),
    );

    const result = await mark(
      resource?.title ?? "Task",
      resource?.subject ?? null,
      questionRows,
      answerMap,
    );

    const now = new Date();
    // A paper with a held question has no release clock: `publish_homework_marks`
    // is only ever run on rows with a `release_at`, so it waits for a tutor to
    // confirm it, with the model's marks and its reasons in front of them.
    const held = result.questions.some((q: StagedMark) => q.held);
    const releaseAt = held ? null : new Date(now.getTime() + REVIEW_WINDOW_MINUTES * 60_000);

    // The marks first. If stamping the submission fails after this, the row is
    // an orphan the publisher ignores (it joins on `release_at`) rather than a
    // release date with nothing behind it.
    const { error: marksError } = await db.from("homework_ai_marks").upsert(
      {
        submission_id: submissionId,
        marks: result.questions,
        summary: result.summary,
        // The words behind each mark, for the student's marked sheet.
        credited: result.credited,
        model: MODEL,
      },
      { onConflict: "submission_id" },
    );
    if (marksError) throw new HttpError(500, marksError.message);

    const { error: stampError } = await db
      .from("homework_submissions")
      .update({ ai_marked_at: now.toISOString(), release_at: releaseAt?.toISOString() ?? null })
      .eq("id", submissionId)
      // Only onto work that is still unmarked. A tutor who marked it by hand
      // while the model was thinking keeps their marks, and the staged row is
      // simply never read.
      .is("graded_at", null);
    if (stampError) throw new HttpError(500, stampError.message);

    return json({ marked: true, held, releaseAt: releaseAt?.toISOString() ?? null });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Marking failed";
    // Marking is best-effort by design: the caller ignores this, and unmarked
    // work simply waits for a tutor. Log it so a systematic failure is visible.
    console.error("[mark-homework]", status, message);
    if (claimed) await release(claimed);
    return json({ error: message }, status);
  }
});

/** Let another run mark this, after one that ended without staging marks. */
async function release(submissionId: string) {
  const { error } = await db
    .from("homework_submissions")
    .update({ ai_marking_started_at: null })
    .eq("id", submissionId)
    .is("ai_marked_at", null);
  // Best effort: an unreleased claim lapses after ten minutes anyway.
  if (error) console.error("[mark-homework] release", error.message);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
