import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import crypto from "node:crypto";
import {
  drainPracticeQueue,
  handlePracticeWorkerRequest,
  runPracticeJobNow,
  type ClaimedJob,
} from "./practiceQueue.server";
import type { GenerationContext } from "../homework/examGeneration";

const originalFetch = globalThis.fetch;
const envNames = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "PRACTICE_WORKER_SECRET",
] as const;
const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
const restore: { mockRestore(): void }[] = [];
beforeEach(() => {
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
  process.env.ANTHROPIC_API_KEY = "test-key";
  // Failures are logged by design; keep the test output to the results.
  restore.push(spyOn(console, "error").mockImplementation(() => {}));
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of envNames) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
  restore.splice(0).forEach((spy) => spy.mockRestore());
});

const POINT = "point-1";
const SECRET = "s".repeat(40);
const job = (over: Partial<ClaimedJob> = {}): ClaimedJob => ({
  job_id: 11,
  claim_token: "token-11",
  spec_point_id: POINT,
  kind: "quiz",
  attempt: 1,
  ...over,
});
const context = (id: string): GenerationContext => ({
  point: {
    id,
    code: "1.1",
    title: "Cells",
    description: "Functions of cell structures.",
    topic_id: "topic-1",
    topic_title: "Cell biology",
    board: "aqa",
    subject: "biology",
    level: "gcse",
    specification_version: null,
    tier: null,
    assessment_context: null,
  },
  examples: [],
  guidance: [],
});

const words = ["one", "two", "three", "four", "five", "six", "seven", "eight"];
const assessment = {
  assessment_objectives: ["AO1"],
  mathematical_demand: false,
  practical_demand: false,
};
/** Questions as the model writes them, untrimmed. */
const mcqs = (count = 8) =>
  words.slice(0, count).map((w, i) => ({
    question: `  Which answer is right for question ${w}?  `,
    options: [
      ` First answer ${w} `,
      `Second answer ${w}`,
      `Third answer ${w}`,
      `Fourth answer ${w}`,
    ],
    correct_index: i % 4,
    explanation: ` The first answer explains ${w}. `,
    ...assessment,
  }));
const tasks = (count = 5) =>
  words.slice(0, count).map((w) => ({
    prompt: `  Explain idea ${w}.  `,
    marks: 2,
    answer_type: "short",
    mark_scheme: ` Credit any clear point about ${w}. `,
    ...assessment,
  }));
const message = (questions: unknown[], stop_reason = "end_turn") =>
  Response.json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    stop_reason,
    stop_sequence: null,
    content: [{ type: "text", text: JSON.stringify({ questions }) }],
    usage: { input_tokens: 1000, output_tokens: 100 },
  });
const apiError = (status: number, type: string, text: string) =>
  Response.json({ type: "error", error: { type, message: text } }, { status });
const down = () => new Response("down", { status: 500 });

type Handler = (body: Record<string, unknown>) => Response | Promise<Response>;

/** The last stub's request headers by path. */
let headers: Record<string, Headers[]> = {};

/**
 * The database and the model behind fetch, routed by path: `rpc/<name>`,
 * `exam_generation_runs`, `/v1/messages`. Returns every request body by path;
 * a request nothing answers fails the test.
 */
function stub(routes: Record<string, Handler>) {
  const calls: Record<string, Record<string, unknown>[]> = {};
  const all: Record<string, Handler> = {
    "rpc/exam_generation_context": (body) => Response.json(context(body._spec_point_id as string)),
    exam_generation_runs: () => new Response(null, { status: 201 }),
    "rpc/fail_practice_job": () => Response.json("pending"),
    ...routes,
  };
  headers = {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname.replace(/^\/rest\/v1\//, "");
    const body = (await request.json()) as Record<string, unknown>;
    (calls[path] ??= []).push(body);
    (headers[path] ??= []).push(request.headers);
    const answer = all[path];
    if (!answer) throw new Error(`Unexpected request to ${path}`);
    return answer(body);
  }) as unknown as typeof fetch;
  return calls;
}

const claims =
  (...jobs: ClaimedJob[]): Handler =>
  () =>
    Response.json(jobs);
const saved =
  (status: string, result_id: string | null): Handler =>
  () =>
    Response.json([{ status, result_id }]);

test("a claimed quiz is written, trimmed and saved under its claim, with its run", async () => {
  const calls = stub({
    "rpc/claim_practice_jobs": claims(job()),
    "/v1/messages": () => message(mcqs()),
    "rpc/complete_practice_job": saved("written", "set-1"),
  });
  expect(await drainPracticeQueue()).toEqual([
    { job_id: 11, spec_point_id: POINT, kind: "quiz", result: "written", result_id: "set-1" },
  ]);
  expect(calls["rpc/claim_practice_jobs"]).toEqual([
    { _limit: 3, _spec_point_id: null, _kind: null },
  ]);
  expect(JSON.stringify(calls["/v1/messages"][0].messages)).toContain("Write exactly 8 MCQs");
  // The call's own limit (200 s, inside the worker's 300 s), not the SDK's ten minutes.
  expect(headers["/v1/messages"][0].get("x-stainless-timeout")).toBe("200");
  const [run] = calls.exam_generation_runs;
  expect(run).toMatchObject({ outcome: "passed", source: "queue", job_id: 11, format: "mcq" });
  expect(calls["rpc/complete_practice_job"]).toEqual([
    {
      _job_id: 11,
      _claim_token: "token-11",
      _run_id: run.id,
      _questions: mcqs().map((q) => ({
        question: q.question.trim(),
        options: q.options.map((o) => o.trim()),
        correct_index: q.correct_index,
        explanation: q.explanation.trim(),
      })),
    },
  ]);
  expect(calls["rpc/fail_practice_job"]).toBeUndefined();
});

test("a claimed task is written with its five questions' marks and schemes", async () => {
  const calls = stub({
    "rpc/claim_practice_jobs": claims(job({ kind: "task" })),
    "/v1/messages": () => message(tasks()),
    "rpc/complete_practice_job": saved("written", "sheet-1"),
  });
  const [outcome] = await drainPracticeQueue();
  expect(outcome).toMatchObject({ kind: "task", result: "written", result_id: "sheet-1" });
  expect(JSON.stringify(calls["/v1/messages"][0].messages)).toContain("Write exactly 5 written");
  expect(calls["rpc/complete_practice_job"][0]._questions).toEqual(
    tasks().map((q) => ({
      prompt: q.prompt.trim(),
      marks: 2,
      answer_type: "short",
      mark_scheme: q.mark_scheme.trim(),
    })),
  );
});

test("content that appeared meanwhile is the database's call: already_existed", async () => {
  stub({
    "rpc/claim_practice_jobs": claims(job()),
    "/v1/messages": () => message(mcqs()),
    "rpc/complete_practice_job": saved("already_existed", "set-0"),
  });
  expect(await drainPracticeQueue()).toEqual([
    {
      job_id: 11,
      spec_point_id: POINT,
      kind: "quiz",
      result: "already_existed",
      result_id: "set-0",
    },
  ]);
});

test("a claim lost before saving is reported, not failed", async () => {
  const calls = stub({
    "rpc/claim_practice_jobs": claims(job()),
    "/v1/messages": () => message(mcqs()),
    "rpc/complete_practice_job": saved("lost_claim", null),
  });
  expect(await drainPracticeQueue()).toEqual([
    { job_id: 11, spec_point_id: POINT, kind: "quiz", result: "lost_claim" },
  ]);
  expect(calls["rpc/fail_practice_job"]).toBeUndefined();
});

test("questions that fail the checks: a failed run with the output, and a retry", async () => {
  const calls = stub({
    "rpc/claim_practice_jobs": claims(job()),
    "/v1/messages": () => message(mcqs(7)),
  });
  expect(await drainPracticeQueue()).toEqual([
    {
      job_id: 11,
      spec_point_id: POINT,
      kind: "quiz",
      result: "failed",
      failure: "retry",
      error: "AI returned the wrong number of questions",
      status_after: "pending",
    },
  ]);
  expect(calls.exam_generation_runs[0]).toMatchObject({
    outcome: "failed",
    error: "AI returned the wrong number of questions",
    raw_output: JSON.stringify({ questions: mcqs(7) }),
    job_id: 11,
  });
  expect(calls["rpc/fail_practice_job"]).toEqual([
    {
      _job_id: 11,
      _claim_token: "token-11",
      _error: "AI returned the wrong number of questions",
      _failure: "retry",
      _pause_minutes: 0,
      // Already recorded as failed; the database only closes a run still passed.
      _run_id: calls.exam_generation_runs[0].id,
    },
  ]);
  expect(calls["rpc/complete_practice_job"]).toBeUndefined();
});

test("out of credit pauses the queue for 30 minutes, with the API's words on record", async () => {
  const credit = "Your credit balance is too low to access the Anthropic API.";
  const calls = stub({
    "rpc/claim_practice_jobs": claims(job()),
    "/v1/messages": () => apiError(400, "invalid_request_error", credit),
    "rpc/fail_practice_job": () => Response.json("pending"),
  });
  const [outcome] = await drainPracticeQueue();
  expect(outcome).toMatchObject({
    result: "failed",
    failure: "outage",
    error: "Question generation failed; please try again",
  });
  expect(calls.exam_generation_runs[0]).toMatchObject({
    outcome: "failed",
    usage: null,
    // Refused, so not billed: the daily cap leaves it out.
    api_status: 400,
    job_id: 11,
  });
  const [failed] = calls["rpc/fail_practice_job"];
  expect(failed).toMatchObject({ _failure: "outage", _pause_minutes: 30 });
  expect(failed._error).toStartWith("Question generation failed; please try again: 400");
  expect(failed._error).toContain(credit);
});

test("a rate limit pauses the queue for 2 minutes, after one call", async () => {
  const calls = stub({
    "rpc/claim_practice_jobs": claims(job()),
    "/v1/messages": () => apiError(429, "rate_limit_error", "Number of requests has exceeded"),
  });
  const [outcome] = await drainPracticeQueue();
  expect(outcome).toMatchObject({
    result: "failed",
    failure: "outage",
    error: "AI rate limit — try again in a moment",
  });
  expect(calls["/v1/messages"]).toHaveLength(1);
  expect(calls["rpc/fail_practice_job"][0]).toMatchObject({
    _failure: "outage",
    _pause_minutes: 2,
  });
});

test("a declined request gives the job up, with the category in its last error", async () => {
  const calls = stub({
    "rpc/claim_practice_jobs": claims(job()),
    "/v1/messages": () =>
      Response.json({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        stop_reason: "refusal",
        stop_sequence: null,
        stop_details: { type: "refusal", category: "bio", explanation: null },
        content: [],
        usage: { input_tokens: 1000, output_tokens: 5 },
      }),
    "rpc/fail_practice_job": () => Response.json("failed"),
  });
  expect(await drainPracticeQueue()).toEqual([
    {
      job_id: 11,
      spec_point_id: POINT,
      kind: "quiz",
      result: "failed",
      failure: "give_up",
      error: "AI declined to write this question set",
      status_after: "failed",
    },
  ]);
  expect(calls["rpc/fail_practice_job"][0]).toMatchObject({
    _failure: "give_up",
    _pause_minutes: 0,
    _error: "AI declined to write this question set: Refused (bio): ",
  });
  expect(calls["rpc/complete_practice_job"]).toBeUndefined();
});

test("a context that cannot be read is a retry, before anything is paid for", async () => {
  const calls = stub({
    "rpc/claim_practice_jobs": claims(job()),
    "rpc/exam_generation_context": down,
  });
  const [outcome] = await drainPracticeQueue();
  expect(outcome).toMatchObject({ result: "failed", failure: "retry", status_after: "pending" });
  expect(calls["/v1/messages"]).toBeUndefined();
  expect(calls.exam_generation_runs).toBeUndefined();
  expect(calls["rpc/fail_practice_job"][0]).toMatchObject({ _failure: "retry", _pause_minutes: 0 });
});

test("a save that fails is a retry", async () => {
  const calls = stub({
    "rpc/claim_practice_jobs": claims(job()),
    "/v1/messages": () => message(mcqs()),
    "rpc/complete_practice_job": () =>
      Response.json({ code: "P0001", message: "Question 3 needs four options" }, { status: 400 }),
  });
  const [outcome] = await drainPracticeQueue();
  expect(outcome).toMatchObject({ result: "failed", failure: "retry" });
  expect(calls["rpc/fail_practice_job"][0]._error).toBe(
    "Exam generation database request failed (400): Question 3 needs four options",
  );
  // The call passed its checks; the failed save is what the database closes the run with.
  expect(calls.exam_generation_runs[0]).toMatchObject({ outcome: "passed" });
  expect(calls["rpc/fail_practice_job"][0]._run_id).toBe(calls.exam_generation_runs[0].id);
});

test("a save whose answer was lost, then found by the database, is not a failure", async () => {
  // The save went through but its response never arrived; reporting the
  // failure finds the claim already released, so the job was written.
  stub({
    "rpc/claim_practice_jobs": claims(job()),
    "/v1/messages": () => message(mcqs()),
    "rpc/complete_practice_job": down,
    "rpc/fail_practice_job": () => Response.json("lost_claim"),
  });
  expect(await drainPracticeQueue()).toEqual([
    { job_id: 11, spec_point_id: POINT, kind: "quiz", result: "lost_claim" },
  ]);
});

test("a failure that cannot be recorded stays inside its job; the others finish", async () => {
  const calls = stub({
    "rpc/claim_practice_jobs": claims(
      job(),
      job({ job_id: 12, claim_token: "token-12", spec_point_id: "point-2" }),
    ),
    "rpc/exam_generation_context": (body) =>
      body._spec_point_id === POINT ? down() : Response.json(context("point-2")),
    "/v1/messages": () => message(mcqs()),
    "rpc/complete_practice_job": saved("written", "set-2"),
    "rpc/fail_practice_job": down,
  });
  expect(await drainPracticeQueue()).toEqual([
    {
      job_id: 11,
      spec_point_id: POINT,
      kind: "quiz",
      result: "failed",
      failure: "retry",
      error:
        "Exam generation database request failed (500); check framework migration and server credentials",
      status_after: "unknown",
    },
    { job_id: 12, spec_point_id: "point-2", kind: "quiz", result: "written", result_id: "set-2" },
  ]);
  expect(calls["rpc/fail_practice_job"]).toHaveLength(1);
  expect(console.error).toHaveBeenCalledWith(
    "[practice-queue] could not record that job 11 failed",
    expect.any(Error),
  );
});

test("the claim asks for 1 to 10 jobs, and only the point it is given", async () => {
  const calls = stub({ "rpc/claim_practice_jobs": claims() });
  expect(await drainPracticeQueue({ maxJobs: 50 })).toEqual([]);
  await drainPracticeQueue({ maxJobs: 0 });
  await drainPracticeQueue({ maxJobs: 2, only: { specPointId: POINT, kind: "task" } });
  expect(calls["rpc/claim_practice_jobs"]).toEqual([
    { _limit: 10, _spec_point_id: null, _kind: null },
    { _limit: 1, _spec_point_id: null, _kind: null },
    { _limit: 2, _spec_point_id: POINT, _kind: "task" },
  ]);
  expect(Object.keys(calls)).toEqual(["rpc/claim_practice_jobs"]);
});

const requested =
  (status: string, result_id: string | null = null): Handler =>
  () =>
    Response.json([{ job_id: 11, status, result_id }]);
const queue =
  (paused_until: string | null): Handler =>
  () =>
    Response.json({ paused_until, pause_reason: null });

test("run now: content the database already has is returned without a claim", async () => {
  const calls = stub({ "rpc/request_practice_job": requested("completed", "set-0") });
  expect(await runPracticeJobNow(POINT, "quiz")).toEqual({
    status: "completed",
    resultId: "set-0",
    created: false,
  });
  expect(calls["rpc/request_practice_job"]).toEqual([
    { _spec_point_id: POINT, _kind: "quiz", _rearm: true },
  ]);
  expect(calls["rpc/claim_practice_jobs"]).toBeUndefined();
});

test("run now: the job is claimed for this point alone, and written", async () => {
  const calls = stub({
    "rpc/request_practice_job": requested("pending"),
    "rpc/claim_practice_jobs": claims(job()),
    "/v1/messages": () => message(mcqs()),
    "rpc/complete_practice_job": saved("written", "set-1"),
  });
  expect(await runPracticeJobNow(POINT, "quiz")).toEqual({
    status: "completed",
    resultId: "set-1",
    created: true,
  });
  expect(calls["rpc/claim_practice_jobs"]).toEqual([
    { _limit: 1, _spec_point_id: POINT, _kind: "quiz" },
  ]);
});

test("run now: content saved meanwhile counts as found, not created", async () => {
  stub({
    "rpc/request_practice_job": requested("pending"),
    "rpc/claim_practice_jobs": claims(job()),
    "/v1/messages": () => message(mcqs()),
    "rpc/complete_practice_job": saved("already_existed", "set-0"),
  });
  expect(await runPracticeJobNow(POINT, "quiz")).toEqual({
    status: "completed",
    resultId: "set-0",
    created: false,
  });
});

test("run now: a failed job is the tutor's error", async () => {
  stub({
    "rpc/request_practice_job": requested("pending"),
    "rpc/claim_practice_jobs": claims(job()),
    "/v1/messages": () => apiError(429, "rate_limit_error", "Slow down"),
  });
  await expect(runPracticeJobNow(POINT, "quiz")).rejects.toThrow(
    "AI rate limit — try again in a moment",
  );
});

test("run now: not handed over — paused, busy or queued", async () => {
  const later = new Date(Date.now() + 60_000).toISOString();
  const earlier = new Date(Date.now() - 60_000).toISOString();
  const nothing = claims();
  stub({
    "rpc/request_practice_job": requested("pending"),
    "rpc/claim_practice_jobs": nothing,
    "rpc/practice_queue_status": queue(later),
  });
  expect(await runPracticeJobNow(POINT, "quiz")).toEqual({ status: "paused" });
  stub({
    "rpc/request_practice_job": requested("generating"),
    "rpc/claim_practice_jobs": nothing,
    "rpc/practice_queue_status": queue(null),
  });
  expect(await runPracticeJobNow(POINT, "quiz")).toEqual({ status: "busy" });
  stub({
    "rpc/request_practice_job": requested("pending"),
    "rpc/claim_practice_jobs": nothing,
    "rpc/practice_queue_status": queue(earlier),
  });
  expect(await runPracticeJobNow(POINT, "quiz")).toEqual({ status: "queued" });
  stub({
    "rpc/request_practice_job": requested("pending"),
    "rpc/claim_practice_jobs": claims(job()),
    "/v1/messages": () => message(mcqs()),
    "rpc/complete_practice_job": saved("lost_claim", null),
    "rpc/practice_queue_status": queue(null),
  });
  expect(await runPracticeJobNow(POINT, "quiz")).toEqual({ status: "busy" });
});

const post = (authorization?: string) =>
  new Request("https://site.example/api/practice-worker", {
    method: "POST",
    headers: authorization === undefined ? {} : { Authorization: authorization },
    body: "{}",
  });
/** Any request at all fails: the route must answer before it claims anything. */
function nothingAllowed() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    throw new Error(`Unexpected request to ${String(input)}`);
  }) as unknown as typeof fetch;
}

test("the worker route answers only POST", async () => {
  process.env.PRACTICE_WORKER_SECRET = SECRET;
  nothingAllowed();
  for (const method of ["GET", "PUT", "DELETE", "OPTIONS"]) {
    const response = await handlePracticeWorkerRequest(
      new Request("https://site.example/api/practice-worker", { method }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toEqual({ error: "Method not allowed" });
  }
});

test("the worker route is closed without a proper secret", async () => {
  nothingAllowed();
  delete process.env.PRACTICE_WORKER_SECRET;
  expect((await handlePracticeWorkerRequest(post(`Bearer ${SECRET}`))).status).toBe(503);
  process.env.PRACTICE_WORKER_SECRET = "s".repeat(31);
  const short = await handlePracticeWorkerRequest(post(`Bearer ${"s".repeat(31)}`));
  expect(short.status).toBe(503);
  expect(await short.json()).toEqual({ error: "The practice worker is not configured" });
});

test("the worker route refuses a missing or wrong bearer secret", async () => {
  process.env.PRACTICE_WORKER_SECRET = SECRET;
  nothingAllowed();
  for (const header of [
    undefined,
    "",
    SECRET,
    `bearer ${SECRET}`,
    `Bearer ${"t".repeat(40)}`,
    `Bearer ${SECRET.slice(1)}`,
    `Bearer ${SECRET}s`,
  ]) {
    const response = await handlePracticeWorkerRequest(post(header));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  }
});

test("the worker route compares in constant time, whatever the header's length", async () => {
  process.env.PRACTICE_WORKER_SECRET = SECRET;
  nothingAllowed();
  const compare = spyOn(crypto, "timingSafeEqual");
  restore.push(compare);
  expect((await handlePracticeWorkerRequest(post("Bearer x"))).status).toBe(401);
  expect(compare).toHaveBeenCalledTimes(1);
  const [given, expected] = compare.mock.calls[0] as unknown as [Buffer, Buffer];
  expect(given.length).toBe(32);
  expect(expected.length).toBe(32);
});

test("the worker route drains up to three jobs and answers JSON", async () => {
  process.env.PRACTICE_WORKER_SECRET = SECRET;
  const calls = stub({
    "rpc/claim_practice_jobs": claims(job()),
    "/v1/messages": () => message(mcqs()),
    "rpc/complete_practice_job": saved("written", "set-1"),
  });
  const response = await handlePracticeWorkerRequest(post(`Bearer ${SECRET}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual({
    claimed: 1,
    outcomes: [
      { job_id: 11, spec_point_id: POINT, kind: "quiz", result: "written", result_id: "set-1" },
    ],
  });
  expect(calls["rpc/claim_practice_jobs"]).toEqual([
    { _limit: 3, _spec_point_id: null, _kind: null },
  ]);
});

test("the worker route answers JSON when even the claim fails", async () => {
  process.env.PRACTICE_WORKER_SECRET = SECRET;
  stub({ "rpc/claim_practice_jobs": down });
  const response = await handlePracticeWorkerRequest(post(`Bearer ${SECRET}`));
  expect(response.status).toBe(500);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect((await response.json()).error).toContain("database request failed (500)");
});
