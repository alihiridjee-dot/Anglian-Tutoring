import "@tanstack/react-start/server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  FRAMEWORK_VERSION,
  buildGenerationPrompt,
  generationSchema,
  validateQuestions,
  type GenerationContext,
  type GenerationFormat,
  type WrittenQuestion,
  type McqQuestion,
} from "./examGeneration";

const MODEL = "claude-sonnet-5-5";

/** What asked for the questions, recorded on the call's run row. */
export type GenerationSource = "queue" | "replace" | "builder";

/**
 * What a failed generation means for the practice queue: try that job again
 * later, stop trying it, or pause every job, because the API is down, out of
 * credit or refusing the key, and the next call would fail the same way.
 */
export type FailureKind = "retry" | "give_up" | "outage";

/** A generation that failed. The message is the one a tutor sees. */
export class GenerationError extends Error {
  constructor(
    message: string,
    readonly failure: FailureKind,
    readonly pauseMinutes: number,
    /** The failed call's `exam_generation_runs` row; null when there was no call, or no row. */
    readonly runId: string | null,
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

export interface GenerateOptions {
  source: GenerationSource;
  /** Free-text steer from a tutor. */
  notes?: string;
  /** The practice-queue job this call writes for. */
  jobId?: number | null;
  /** Passed to the Anthropic client when given; its own defaults otherwise. */
  timeoutMs?: number;
  maxRetries?: number;
}

export interface GenerationResult<Q> {
  questions: Q[];
  /** The call's `exam_generation_runs` row; null only if writing it failed. */
  runId: string | null;
}

/**
 * One model call's limit, for every caller. A set rarely takes over a minute,
 * so 200 s leaves room without letting a stuck call run on; within the queue
 * worker's 300 s, and the practice queue's 360 s lease outlasts both. No SDK
 * retries: each would be another paid attempt behind one run row, and the
 * queue (or the tutor, pressing again) retries knowingly.
 */
export const CALL_LIMITS: Pick<GenerateOptions, "timeoutMs" | "maxRetries"> = {
  timeoutMs: 200_000,
  maxRetries: 0,
};

/** Shown to a tutor for any call the API refused or never answered, bar a rate limit. */
const CALL_FAILED = "Question generation failed; please try again";

/** How much of a failed call's output its run row keeps. */
const RAW_OUTPUT_CHARS = 20_000;

/**
 * Privileged calls stay server-only; no public endpoint exposes the source library.
 * Also the only route to writers a browser must never reach directly, such as the
 * shared MCQ sets.
 */
export async function libraryRequest(path: string, body: unknown): Promise<unknown> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Exam generation requires the server Supabase service credential");
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // Do not mistake a broken migration/credential for an empty exemplar library.
    const reason = await databaseMessage(response);
    throw new Error(
      `Exam generation database request failed (${response.status})` +
        (reason ? `: ${reason}` : "; check framework migration and server credentials"),
    );
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/**
 * PostgREST's own explanation of a failure, when it sent one: a function that
 * isn't there, or a save the database refused, and why.
 */
async function databaseMessage(response: Response): Promise<string | null> {
  try {
    const { message } = JSON.parse(await response.text()) as { message?: unknown };
    return typeof message === "string" && message ? message.slice(0, 300) : null;
  } catch {
    return null;
  }
}

/**
 * The curriculum point, exemplars and board guidance a generation is grounded
 * in, read with the server credential because the exemplar library is
 * tutor-only. No caller check: the practice queue's worker has no caller.
 * Anything acting for a signed-in user goes through `loadGenerationContext`.
 */
export async function fetchGenerationContext(pointId: string): Promise<GenerationContext> {
  const value = await libraryRequest("rpc/exam_generation_context", { _spec_point_id: pointId });
  const context = value as GenerationContext | null;
  if (
    !context?.point ||
    context.point.id !== pointId ||
    !Array.isArray(context.examples) ||
    !Array.isArray(context.guidance)
  ) {
    throw new Error("Exam generation context is incomplete");
  }
  return context;
}

export async function loadGenerationContext(
  supabase: SupabaseClient<Database>,
  pointId: string,
): Promise<GenerationContext> {
  // This read uses the authenticated caller, so service-role retrieval cannot
  // let a student generate content for an inaccessible curriculum point.
  const { data: point, error } = await supabase
    .from("spec_points")
    .select("id")
    .eq("id", pointId)
    .single();
  if (error || !point) throw new Error("Specification point is unavailable");
  return fetchGenerationContext(pointId);
}

/**
 * What a call the API refused, or never answered, means for the queue. Typed
 * SDK errors only; the one message read is the credit notice, which arrives as
 * an ordinary 400.
 */
function classifyApiError(error: unknown): {
  failure: FailureKind;
  pauseMinutes: number;
  message: string;
} {
  // The client's timer covers the whole answer, so a timeout is a slow call,
  // not a dead API. As an outage it would hand the attempt back and loop.
  if (error instanceof Anthropic.APIConnectionTimeoutError)
    return { failure: "retry", pauseMinutes: 0, message: CALL_FAILED };
  // No answer at all: the network or the API is down.
  if (error instanceof Anthropic.APIConnectionError)
    return { failure: "outage", pauseMinutes: 2, message: CALL_FAILED };
  const status = error instanceof Anthropic.APIError ? (error.status ?? 0) : 0;
  if (status === 429)
    return {
      failure: "outage",
      pauseMinutes: 2,
      message: "AI rate limit — try again in a moment",
    };
  // Out of credit, a billing problem, the key refused, or the model not open to
  // this account: nothing will work until someone sees to it. 402 is the API's
  // billing error.
  if (
    status === 401 ||
    status === 402 ||
    status === 403 ||
    status === 404 ||
    (status === 400 && /credit balance/i.test((error as Error).message))
  )
    return { failure: "outage", pauseMinutes: 30, message: CALL_FAILED };
  if (status >= 500) return { failure: "outage", pauseMinutes: 2, message: CALL_FAILED };
  // A request timeout or a conflict on the API's side: this request, not all of them.
  if (status === 408 || status === 409)
    return { failure: "retry", pauseMinutes: 0, message: CALL_FAILED };
  // The API calls the request itself invalid, so sending it again is refused again.
  if (status >= 400) return { failure: "give_up", pauseMinutes: 0, message: CALL_FAILED };
  // No status: the SDK's own error, not the API's. Worth another try later.
  return { failure: "retry", pauseMinutes: 0, message: CALL_FAILED };
}

/** The questions in a finished answer, or the reason there are none. */
function readQuestions(
  stopReason: string | null,
  text: string,
  count: number,
  format: GenerationFormat,
): WrittenQuestion[] | McqQuestion[] {
  if (stopReason !== "end_turn") throw new Error("AI did not complete the question set");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("AI returned invalid JSON");
  }
  return validateQuestions(value, count, format);
}

/** The first characters of a text, never half of one: the database refuses a split pair. */
function firstChars(text: string, limit: number): string {
  return Array.from(text).slice(0, limit).join("");
}

/**
 * One `exam_generation_runs` row for one model call, pass or fail, so every
 * call, paid or refused, can be counted. Audit only: a failed write is
 * reported and returns null, and never costs the caller a valid set.
 */
async function recordRun(row: Record<string, unknown>): Promise<string | null> {
  const id = crypto.randomUUID();
  try {
    await libraryRequest("exam_generation_runs", { id, ...row });
    return id;
  } catch (error) {
    console.error("[exam-generation] could not save generation trace", error);
    return null;
  }
}

/**
 * One model call for `count` questions on a spec point. Throws a
 * `GenerationError` when the call fails, is cut off, or its questions fail the
 * checks; either way the call is recorded.
 */
export async function generateExamQuestions(
  context: GenerationContext,
  count: number,
  format: "written",
  opts: GenerateOptions,
): Promise<GenerationResult<WrittenQuestion>>;
export async function generateExamQuestions(
  context: GenerationContext,
  count: number,
  format: "mcq",
  opts: GenerateOptions,
): Promise<GenerationResult<McqQuestion>>;
export async function generateExamQuestions(
  context: GenerationContext,
  count: number,
  format: GenerationFormat,
  opts: GenerateOptions,
): Promise<GenerationResult<WrittenQuestion | McqQuestion>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  // No call, so no run row. Every job would fail the same way, so it pauses the queue.
  if (!apiKey) throw new GenerationError("ANTHROPIC_API_KEY not configured", "outage", 30, null);
  const prompt = buildGenerationPrompt(context, count, format, opts.notes);
  const client = new Anthropic({
    apiKey,
    ...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
    ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
  });
  // What every run row says about this call, whatever its outcome.
  const call = {
    spec_point_id: context.point.id,
    framework_version: FRAMEWORK_VERSION,
    model: MODEL,
    format,
    grounding: prompt.grounding,
    exemplar_ids: prompt.examples.map((e) => e.id),
    source: opts.source,
    job_id: opts.jobId ?? null,
  };
  const started = Date.now();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      // Sonnet 5.5 thinks before answering, and that thinking counts against this
      // ceiling: a per-question estimate left an 8-question set ~400 tokens for
      // the JSON itself. Passing sets peak near 8,000 tokens, thinking included,
      // so this is generous; above 21,333 the SDK refuses a call that has no
      // timeout of its own and isn't streamed. Only tokens produced are billed.
      max_tokens: 20_000,
      system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }],
      output_config: {
        // The model's default, pinned so a change of default can't change the questions.
        effort: "high",
        format: { type: "json_schema", schema: generationSchema(format) },
      },
      messages: [{ role: "user", content: prompt.user }],
    });
  } catch (error) {
    const { failure, pauseMinutes, message } = classifyApiError(error);
    // The API answered with an error, so nothing was generated or billed, and
    // the queue's daily cap leaves the call out. A timeout or a dropped
    // connection has no status: it may have been billed, so it still counts.
    const status = error instanceof Anthropic.APIError ? error.status : undefined;
    const runId = await recordRun({
      ...call,
      outcome: "failed",
      error: error instanceof Error ? error.message : String(error),
      api_status: typeof status === "number" && status >= 400 && status <= 599 ? status : null,
      usage: null,
      generated_questions: null,
      duration_ms: Date.now() - started,
    });
    const failed = new GenerationError(message, failure, pauseMinutes, runId);
    // The API's own words, for whoever reads the queue: the message is a tutor's.
    failed.cause = error;
    throw failed;
  }
  const answered = {
    ...call,
    // The model that actually answered, which the request only names.
    model: response.model,
    stop_reason: response.stop_reason,
    usage: response.usage,
    duration_ms: Date.now() - started,
  };
  if (response.stop_reason === "refusal") {
    // Sending the same request again would be declined again, so the job stops
    // here; the queue gives a failed job one fresh round a day while its point
    // is in someone's week. A decline can still be billed: the row keeps the usage.
    const details = response.stop_details;
    const reason = `Refused (${details?.category ?? "unknown"}): ${details?.explanation ?? ""}`;
    const runId = await recordRun({
      ...answered,
      outcome: "failed",
      error: reason,
      generated_questions: null,
    });
    const failed = new GenerationError(
      "AI declined to write this question set",
      "give_up",
      0,
      runId,
    );
    failed.cause = new Error(reason);
    throw failed;
  }
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let questions: WrittenQuestion[] | McqQuestion[];
  try {
    questions = readQuestions(response.stop_reason, text, count, format);
  } catch (error) {
    // Paid for, and worth reading later: the row keeps what came back.
    const message = error instanceof Error ? error.message : String(error);
    const runId = await recordRun({
      ...answered,
      outcome: "failed",
      error: message,
      raw_output: firstChars(text, RAW_OUTPUT_CHARS),
      generated_questions: null,
    });
    throw new GenerationError(message, "retry", 0, runId);
  }
  const runId = await recordRun({ ...answered, outcome: "passed", generated_questions: questions });
  return { questions, runId };
}
