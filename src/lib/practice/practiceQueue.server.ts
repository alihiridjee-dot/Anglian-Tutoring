import "@tanstack/react-start/server-only";
import crypto from "node:crypto";
import {
  CALL_LIMITS,
  GenerationError,
  fetchGenerationContext,
  generateExamQuestions,
  libraryRequest,
  type FailureKind,
  type GenerateOptions,
} from "../homework/examGeneration.server";

// The practice queue is the one writer of the library's quizzes and tasks: each
// spec point has one shared quiz and one shared task, read by every student
// whose week reaches it. Saving a week queues the points that lack them (a
// database trigger), and pg_cron calls the worker route every minute while jobs
// are ready.
//
// The database decides everything that could happen twice. It hands a job to
// one claimant at a time, checks the library again before handing it out and
// again when saving, and caps the calls in flight and per day. This side claims,
// writes, and reports back how it went.

export type PracticeKind = "quiz" | "task";

/** Questions in each point's shared quiz and task. */
export const QUESTIONS: Record<PracticeKind, number> = { quiz: 8, task: 5 };

/** A job this worker holds, from `claim_practice_jobs`. */
export interface ClaimedJob {
  job_id: number;
  claim_token: string;
  spec_point_id: string;
  kind: PracticeKind;
  attempt: number;
}

export type JobOutcome =
  | {
      job_id: number;
      spec_point_id: string;
      kind: PracticeKind;
      result: "written" | "already_existed";
      result_id: string;
    }
  | { job_id: number; spec_point_id: string; kind: PracticeKind; result: "lost_claim" }
  | {
      job_id: number;
      spec_point_id: string;
      kind: PracticeKind;
      result: "failed";
      failure: FailureKind;
      error: string;
      status_after: string;
    };

/** The model's questions for a job, trimmed to what the save stores. */
async function writeQuestions(
  job: ClaimedJob,
): Promise<{ payload: Record<string, unknown>[]; runId: string | null }> {
  const context = await fetchGenerationContext(job.spec_point_id);
  // Three run side by side within the worker's 300 s, and the database's lease
  // (360 s) outlasts them, so a job is never handed to a second worker while
  // the first could still save it.
  const options: GenerateOptions = { ...CALL_LIMITS, source: "queue", jobId: job.job_id };
  if (job.kind === "quiz") {
    const { questions, runId } = await generateExamQuestions(
      context,
      QUESTIONS.quiz,
      "mcq",
      options,
    );
    const payload = questions.map((q) => ({
      question: q.question.trim(),
      options: q.options.map((o) => o.trim()),
      correct_index: q.correct_index,
      explanation: q.explanation.trim(),
    }));
    return { payload, runId };
  }
  const { questions, runId } = await generateExamQuestions(
    context,
    QUESTIONS.task,
    "written",
    options,
  );
  const payload = questions.map((q) => ({
    prompt: q.prompt.trim(),
    marks: q.marks,
    answer_type: q.answer_type,
    mark_scheme: q.mark_scheme.trim(),
  }));
  return { payload, runId };
}

/**
 * Write one claimed job and report back. Never throws: every claimed job ends
 * completed, failed, or, if even reporting the failure fails, back in the
 * queue when its lease runs out.
 */
async function runClaimedJob(job: ClaimedJob): Promise<JobOutcome> {
  const about = { job_id: job.job_id, spec_point_id: job.spec_point_id, kind: job.kind };
  // The call's run, so a save that fails can close it as failed.
  let runId: string | null = null;
  try {
    const written = await writeQuestions(job);
    const payload = written.payload;
    runId = written.runId;
    // Saves only while this claim still holds, and keeps whatever got there first.
    const [saved] = (await libraryRequest("rpc/complete_practice_job", {
      _job_id: job.job_id,
      _claim_token: job.claim_token,
      _questions: payload,
      _run_id: runId,
    })) as { status: string; result_id: string | null }[];
    if (saved?.status === "lost_claim") return { ...about, result: "lost_claim" };
    if ((saved?.status === "written" || saved?.status === "already_existed") && saved.result_id)
      return { ...about, result: saved.status, result_id: saved.result_id };
    throw new Error(`The practice queue gave no result for job ${job.job_id}`);
  } catch (error) {
    // A failed call records its own run; only a failed save leaves one open.
    return failJob(job, error, runId ?? (error instanceof GenerationError ? error.runId : null));
  }
}

/**
 * Tell the database a job failed, and how. A GenerationError carries its own
 * verdict: an outage pauses the queue rather than counting against the job.
 * Anything else, the context read or the save, is worth another try later.
 */
async function failJob(job: ClaimedJob, error: unknown, runId: string | null): Promise<JobOutcome> {
  const failure: FailureKind = error instanceof GenerationError ? error.failure : "retry";
  const pauseMinutes = error instanceof GenerationError ? error.pauseMinutes : 0;
  const message = error instanceof Error ? error.message : String(error);
  // The API's own words where it gave any ("credit balance is too low"): what
  // the queue's status needs to show, where the message is meant for a tutor.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
  console.error(`[practice-queue] job ${job.job_id} (${job.kind}) failed: ${message}`);
  let statusAfter = "unknown";
  try {
    const status = await libraryRequest("rpc/fail_practice_job", {
      _job_id: job.job_id,
      _claim_token: job.claim_token,
      _error: cause ? `${message}: ${cause}` : message,
      _failure: failure,
      _pause_minutes: pauseMinutes,
      // Marks the run failed only if it still reads passed (a save that raised).
      _run_id: runId,
    });
    // The claim had already gone: another worker holds the job, or this one's
    // save went through before its answer was lost. Either way, not a failure.
    if (status === "lost_claim")
      return {
        job_id: job.job_id,
        spec_point_id: job.spec_point_id,
        kind: job.kind,
        result: "lost_claim",
      };
    if (typeof status === "string") statusAfter = status;
  } catch (reportError) {
    // The claim stays until its lease runs out; then the job is ready again.
    console.error(`[practice-queue] could not record that job ${job.job_id} failed`, reportError);
  }
  return {
    job_id: job.job_id,
    spec_point_id: job.spec_point_id,
    kind: job.kind,
    result: "failed",
    failure,
    error: message,
    status_after: statusAfter,
  };
}

/**
 * Claim up to `maxJobs` ready jobs (3 unless asked, 10 at most) and write them
 * side by side. The database may hand out fewer or none: the queue is paused,
 * at its in-flight or daily limit, or has nothing ready. `only` narrows the
 * claim to one point's job.
 */
export async function drainPracticeQueue(opts?: {
  maxJobs?: number;
  only?: { specPointId: string; kind: PracticeKind };
}): Promise<JobOutcome[]> {
  const limit = Math.min(10, Math.max(1, Math.floor(opts?.maxJobs ?? 3)));
  const jobs = (await libraryRequest("rpc/claim_practice_jobs", {
    _limit: limit,
    _spec_point_id: opts?.only?.specPointId ?? null,
    _kind: opts?.only?.kind ?? null,
  })) as ClaimedJob[];
  // runClaimedJob never throws; allSettled keeps one job's surprise from
  // costing the others their results anyway.
  const settled = await Promise.allSettled(jobs.map(runClaimedJob));
  return settled.map((result, i): JobOutcome => {
    if (result.status === "fulfilled") return result.value;
    console.error(`[practice-queue] job ${jobs[i].job_id} stopped unreported`, result.reason);
    return {
      job_id: jobs[i].job_id,
      spec_point_id: jobs[i].spec_point_id,
      kind: jobs[i].kind,
      result: "failed",
      failure: "retry",
      error: "The worker stopped before reporting this job",
      status_after: "unknown",
    };
  });
}

/**
 * A tutor's "generate" for one point: that point's job, run in this request
 * when the queue will hand it over. The same claim as the worker's, so it
 * never pays for content that exists or a job already being written.
 */
export async function runPracticeJobNow(
  specPointId: string,
  kind: PracticeKind,
): Promise<
  | { status: "completed"; resultId: string; created: boolean }
  | { status: "queued" | "busy" | "paused" }
> {
  const [job] = (await libraryRequest("rpc/request_practice_job", {
    _spec_point_id: specPointId,
    _kind: kind,
    _rearm: true,
  })) as { job_id: number; status: string; result_id: string | null }[];
  if (job?.status === "completed" && job.result_id)
    return { status: "completed", resultId: job.result_id, created: false };

  const [outcome] = await drainPracticeQueue({ maxJobs: 1, only: { specPointId, kind } });
  if (outcome?.result === "written")
    return { status: "completed", resultId: outcome.result_id, created: true };
  if (outcome?.result === "already_existed")
    return { status: "completed", resultId: outcome.result_id, created: false };
  if (outcome?.result === "failed") throw new Error(outcome.error);

  // Not run here. The worker will write it when it can.
  const queue = (await libraryRequest("rpc/practice_queue_status", {})) as {
    paused_until: string | null;
  } | null;
  if (queue?.paused_until && Date.parse(queue.paused_until) > Date.now())
    return { status: "paused" };
  // A lost claim means another worker took the job over.
  if (outcome?.result === "lost_claim" || job?.status === "generating") return { status: "busy" };
  return { status: "queued" };
}

/** The shortest worker secret accepted; anything shorter counts as unset. */
const MIN_SECRET_LENGTH = 32;

/**
 * Compares digests of the two, so the time taken says nothing about how much
 * of the header matched, nor how long the secret is.
 */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => crypto.createHash("sha256").update(value).digest();
  return crypto.timingSafeEqual(digest(given), digest(expected));
}

/**
 * `POST /api/practice-worker`, which pg_cron calls every minute while jobs are
 * ready, with `Authorization: Bearer <PRACTICE_WORKER_SECRET>`. Always answers
 * JSON, failures included: anything thrown here would become the site's HTML
 * error page.
 */
export async function handlePracticeWorkerRequest(request: Request): Promise<Response> {
  if (request.method !== "POST")
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  // Trimmed like the header it is compared with (and like Vault's copy).
  const secret = process.env.PRACTICE_WORKER_SECRET?.trim();
  // Fails closed: without a proper secret, nobody can start paid generations.
  if (!secret || secret.length < MIN_SECRET_LENGTH)
    return Response.json({ error: "The practice worker is not configured" }, { status: 503 });
  if (!sameSecret(request.headers.get("authorization") ?? "", `Bearer ${secret}`))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const outcomes = await drainPracticeQueue({ maxJobs: 3 });
    return Response.json({ claimed: outcomes.length, outcomes });
  } catch (error) {
    console.error("[practice-worker] could not claim jobs", error);
    const message = error instanceof Error ? error.message : "The practice worker failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
