import { afterEach, expect, spyOn, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  GenerationError,
  fetchGenerationContext,
  generateExamQuestions,
  loadGenerationContext,
  type FailureKind,
} from "./examGeneration.server";
import type { GenerationContext } from "./examGeneration";

const originalFetch = globalThis.fetch;
const envNames = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"] as const;
const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
const restore: { mockRestore(): void }[] = [];
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of envNames) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
  restore.splice(0).forEach((spy) => spy.mockRestore());
});
const context: GenerationContext = {
  point: {
    id: "point-1",
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
};
const question = {
  prompt: "State the function of the nucleus.",
  marks: 1,
  answer_type: "short" as const,
  mark_scheme: "Contains genetic material that controls cell activities (1).",
  assessment_objectives: ["AO1"],
  mathematical_demand: false,
  practical_demand: false,
};
function caller(allowed: boolean) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () =>
            allowed
              ? { data: { id: "point-1" }, error: null }
              : { data: null, error: { message: "denied" } },
        }),
      }),
    }),
  } as unknown as SupabaseClient<Database>;
}
function credentials() {
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
  process.env.ANTHROPIC_API_KEY = "test-key";
}
function quiet() {
  restore.push(spyOn(console, "error").mockImplementation(() => {}));
}
function message(text: string, stop_reason = "end_turn", extra: Record<string, unknown> = {}) {
  return Response.json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    stop_reason,
    stop_sequence: null,
    stop_details: null,
    content: [{ type: "text", text }],
    usage: { input_tokens: 1000, output_tokens: 100 },
    ...extra,
  });
}
function apiError(status: number, type: string, text: string) {
  return Response.json({ type: "error", error: { type, message: text } }, { status });
}

/**
 * Model calls answered by `answer`, run rows collected. Everything else the
 * code asks the database is unexpected.
 */
function stub(
  answer: (body: Record<string, unknown>, signal: AbortSignal) => Response | Promise<Response>,
) {
  const runs: Record<string, unknown>[] = [];
  let modelCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const body = await request.json();
    if (request.url.includes("/v1/messages")) {
      modelCalls++;
      return answer(body, init?.signal ?? request.signal);
    }
    if (request.url.endsWith("/rest/v1/exam_generation_runs")) {
      runs.push(body);
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected request to ${request.url}`);
  }) as unknown as typeof fetch;
  return { runs, modelCalls: () => modelCalls };
}

async function failure(promise: Promise<unknown>): Promise<GenerationError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GenerationError) return error;
    throw error;
  }
  throw new Error("Expected the generation to fail");
}

test("RLS rejection prevents a privileged library request", async () => {
  credentials();
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    throw new Error("Unexpected request");
  }) as unknown as typeof fetch;
  await expect(loadGenerationContext(caller(false), "point-1")).rejects.toThrow("unavailable");
  expect(requests).toBe(0);
});

test("empty library is valid, but database failure does not silently become empty", async () => {
  credentials();
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("apikey")).toBe("sb_secret_test");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    return Response.json(context);
  }) as unknown as typeof fetch;
  expect(await loadGenerationContext(caller(true), "point-1")).toEqual(context);
  globalThis.fetch = (async () =>
    new Response("missing migration", { status: 404 })) as unknown as typeof fetch;
  await expect(loadGenerationContext(caller(true), "point-1")).rejects.toThrow("migration");
});

test("the server-credential read needs no caller, and says why the database refused", async () => {
  credentials();
  globalThis.fetch = (async () => Response.json(context)) as unknown as typeof fetch;
  expect(await fetchGenerationContext("point-1")).toEqual(context);
  globalThis.fetch = (async () =>
    Response.json(
      { code: "PGRST202", message: "Could not find the function public.exam_generation_context" },
      { status: 404 },
    )) as unknown as typeof fetch;
  await expect(fetchGenerationContext("point-1")).rejects.toThrow(
    "(404): Could not find the function public.exam_generation_context",
  );
});

test("one model call produces a validated question and records a passed run", async () => {
  credentials();
  const api = stub((body) => {
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBe(20_000);
    expect(body.output_config).toMatchObject({ effort: "high", format: { type: "json_schema" } });
    expect(JSON.stringify(body.messages)).toContain("Functions of cell structures");
    // The run row records the model that answered, not the one asked for.
    return message(JSON.stringify({ questions: [question] }), "end_turn", {
      model: "claude-sonnet-5-5-served",
    });
  });
  const result = await generateExamQuestions(context, 1, "written", { source: "builder" });
  expect(result.questions).toEqual([question]);
  expect(api.modelCalls()).toBe(1);
  expect(api.runs).toHaveLength(1);
  const [run] = api.runs;
  expect(run.id).toBe(result.runId!);
  expect(run.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(run).toMatchObject({
    spec_point_id: "point-1",
    model: "claude-sonnet-5-5-served",
    outcome: "passed",
    source: "builder",
    job_id: null,
    grounding: "curriculum_only",
    exemplar_ids: [],
    stop_reason: "end_turn",
    usage: { input_tokens: 1000, output_tokens: 100 },
    generated_questions: [question],
  });
  expect(run.duration_ms).toBeNumber();
  expect(run.error).toBeUndefined();
  expect(run.raw_output).toBeUndefined();
});

test("truncated output is never returned, and its call is recorded as failed", async () => {
  credentials();
  const api = stub(() => message('{"questions":[]}', "max_tokens"));
  const error = await failure(generateExamQuestions(context, 5, "written", { source: "builder" }));
  expect(error.message).toContain("did not complete");
  expect(error.failure).toBe("retry");
  expect(api.modelCalls()).toBe(1);
  expect(api.runs[0]).toMatchObject({
    outcome: "failed",
    error: "AI did not complete the question set",
    stop_reason: "max_tokens",
    raw_output: '{"questions":[]}',
    generated_questions: null,
  });
  expect(error.runId).toBe(api.runs[0].id as string);
});

test("questions that fail the checks are recorded with what the model wrote", async () => {
  credentials();
  const text = JSON.stringify({ questions: [question, question] });
  const api = stub(() => message(text));
  const error = await failure(
    generateExamQuestions(context, 3, "written", { source: "queue", jobId: 42 }),
  );
  expect(error.failure).toBe("retry");
  expect(error.pauseMinutes).toBe(0);
  expect(error.message).toBe("AI returned the wrong number of questions");
  expect(api.runs).toHaveLength(1);
  expect(api.runs[0]).toMatchObject({
    outcome: "failed",
    error: error.message,
    raw_output: text,
    generated_questions: null,
    source: "queue",
    job_id: 42,
    usage: { input_tokens: 1000, output_tokens: 100 },
  });
});

test("invalid JSON is a retry, and a long answer is kept to its first 20 000 characters", async () => {
  credentials();
  // An emoji straddles the cut, so a plain slice would leave half of it.
  const text = `${"x".repeat(19_999)}🧬${"y".repeat(5000)}`;
  const api = stub(() => message(text));
  const error = await failure(generateExamQuestions(context, 1, "mcq", { source: "replace" }));
  expect(error.message).toBe("AI returned invalid JSON");
  expect(error.failure).toBe("retry");
  expect(api.runs[0].raw_output).toBe(`${"x".repeat(19_999)}🧬`);
});

test("a call the API turns away is recorded with no usage, and keeps the API's words", async () => {
  credentials();
  const api = stub(() => apiError(529, "overloaded_error", "Overloaded"));
  const error = await failure(
    generateExamQuestions(context, 1, "written", { source: "queue", jobId: 7, maxRetries: 0 }),
  );
  expect(error.message).toBe("Question generation failed; please try again");
  expect(error.failure).toBe("outage");
  expect(error.pauseMinutes).toBe(2);
  expect((error.cause as Error).message).toContain("Overloaded");
  expect(api.runs).toHaveLength(1);
  expect(api.runs[0]).toMatchObject({
    // No answer, so the model asked for.
    model: "claude-sonnet-5-5",
    outcome: "failed",
    usage: null,
    generated_questions: null,
    source: "queue",
    job_id: 7,
  });
  expect(api.runs[0].error).toContain("529");
  expect(api.runs[0].raw_output).toBeUndefined();
  expect(api.runs[0].stop_reason).toBeUndefined();
  expect(error.runId).toBe(api.runs[0].id as string);
});

test("failures are classified for the queue", async () => {
  credentials();
  const credit = "Your credit balance is too low to access the Anthropic API.";
  const cases: [string, () => Response, FailureKind, number, string][] = [
    ["out of credit", () => apiError(400, "invalid_request_error", credit), "outage", 30, "failed"],
    [
      "bad request",
      () => apiError(400, "invalid_request_error", "max_tokens: too large"),
      "give_up",
      0,
      "failed",
    ],
    [
      "bad key",
      () => apiError(401, "authentication_error", "invalid x-api-key"),
      "outage",
      30,
      "failed",
    ],
    ["billing", () => apiError(402, "billing_error", "Payment required"), "outage", 30, "failed"],
    ["forbidden", () => apiError(403, "permission_error", "Not allowed"), "outage", 30, "failed"],
    ["model not open", () => apiError(404, "not_found_error", "model: x"), "outage", 30, "failed"],
    ["request timeout", () => apiError(408, "timeout_error", "Timed out"), "retry", 0, "failed"],
    ["conflict", () => apiError(409, "invalid_request_error", "Conflict"), "retry", 0, "failed"],
    ["too large", () => apiError(413, "request_too_large", "Too large"), "give_up", 0, "failed"],
    ["rate limit", () => apiError(429, "rate_limit_error", "Slow down"), "outage", 2, "rate limit"],
    ["server error", () => apiError(500, "api_error", "Internal"), "outage", 2, "failed"],
    ["overloaded", () => apiError(529, "overloaded_error", "Overloaded"), "outage", 2, "failed"],
  ];
  for (const [name, answer, kind, minutes, shown] of cases) {
    stub(answer);
    const error = await failure(
      generateExamQuestions(context, 1, "written", { source: "builder", maxRetries: 0 }),
    );
    expect({ name, failure: error.failure, pauseMinutes: error.pauseMinutes }).toEqual({
      name,
      failure: kind,
      pauseMinutes: minutes,
    });
    expect(error.message).toContain(shown);
  }
});

test("no answer at all is an outage; a timeout is a slow call, tried again", async () => {
  credentials();
  stub(() => {
    throw new TypeError("fetch failed");
  });
  const refused = await failure(
    generateExamQuestions(context, 1, "written", { source: "builder", maxRetries: 0 }),
  );
  expect([refused.failure, refused.pauseMinutes]).toEqual(["outage", 2]);

  // Never answers; the client gives up after timeoutMs.
  const api = stub(
    (_, signal) =>
      new Promise<Response>((_, reject) =>
        signal.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        ),
      ),
  );
  const slow = await failure(
    generateExamQuestions(context, 1, "written", { source: "queue", timeoutMs: 20, maxRetries: 0 }),
  );
  expect([slow.failure, slow.pauseMinutes]).toEqual(["retry", 0]);
  expect(slow.message).toBe("Question generation failed; please try again");
  expect(api.runs[0]).toMatchObject({ outcome: "failed", usage: null });
  expect(api.runs[0].error).toContain("timed out");
});

test("a declined request is given up, with its category on record and its usage kept", async () => {
  credentials();
  const api = stub(() =>
    message('{"questions":[', "refusal", {
      model: "claude-sonnet-5-5-served",
      stop_details: { type: "refusal", category: "bio", explanation: "Possible biological harm." },
      usage: { input_tokens: 1000, output_tokens: 12 },
    }),
  );
  const error = await failure(
    generateExamQuestions(context, 1, "written", { source: "queue", jobId: 3 }),
  );
  expect(error.message).toBe("AI declined to write this question set");
  expect([error.failure, error.pauseMinutes]).toEqual(["give_up", 0]);
  expect((error.cause as Error).message).toBe("Refused (bio): Possible biological harm.");
  expect(api.modelCalls()).toBe(1);
  expect(api.runs).toHaveLength(1);
  expect(api.runs[0]).toMatchObject({
    outcome: "failed",
    error: "Refused (bio): Possible biological harm.",
    stop_reason: "refusal",
    model: "claude-sonnet-5-5-served",
    usage: { input_tokens: 1000, output_tokens: 12 },
    generated_questions: null,
    job_id: 3,
  });
  // Declined before its text was read: no partial output kept.
  expect(api.runs[0].raw_output).toBeUndefined();
  expect(error.runId).toBe(api.runs[0].id as string);

  // A decline without details still says what happened.
  const bare = stub(() => message("", "refusal"));
  const unexplained = await failure(
    generateExamQuestions(context, 1, "written", { source: "builder" }),
  );
  expect(unexplained.failure).toBe("give_up");
  expect(bare.runs[0].error).toBe("Refused (unknown): ");
});

test("maxRetries reaches the client; the SDK's own retries are the default", async () => {
  credentials();
  // retry-after-ms keeps the SDK's backoff to a millisecond.
  const internal = () =>
    Response.json(
      { type: "error", error: { type: "api_error", message: "Internal" } },
      { status: 500, headers: { "retry-after-ms": "1" } },
    );
  const calls = async (maxRetries?: number) => {
    const api = stub(internal);
    await failure(generateExamQuestions(context, 1, "written", { source: "builder", maxRetries }));
    return api.modelCalls();
  };
  expect(await calls(0)).toBe(1);
  expect(await calls(1)).toBe(2);
  expect(await calls()).toBe(3);
});

test("a run row that cannot be written never costs a valid set", async () => {
  credentials();
  quiet();
  let modelCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url.includes("/v1/messages")) {
      modelCalls++;
      return message(JSON.stringify({ questions: [question] }));
    }
    return new Response("down", { status: 503 });
  }) as unknown as typeof fetch;
  const result = await generateExamQuestions(context, 1, "written", { source: "builder" });
  expect(result).toEqual({ questions: [question], runId: null });
  expect(modelCalls).toBe(1);
  expect(console.error).toHaveBeenCalled();
});

test("without an API key nothing is called, and the queue is told to pause", async () => {
  credentials();
  delete process.env.ANTHROPIC_API_KEY;
  const api = stub(() => {
    throw new Error("Unexpected model call");
  });
  const error = await failure(generateExamQuestions(context, 1, "mcq", { source: "queue" }));
  expect(error.message).toBe("ANTHROPIC_API_KEY not configured");
  expect([error.failure, error.pauseMinutes, error.runId]).toEqual(["outage", 30, null]);
  expect(api.modelCalls()).toBe(0);
  expect(api.runs).toHaveLength(0);
});
