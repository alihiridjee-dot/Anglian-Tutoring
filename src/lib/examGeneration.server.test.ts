import { afterEach, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { generateExamQuestions, loadGenerationContext } from "./examGeneration.server";
import type { GenerationContext } from "./examGeneration";

const originalFetch = globalThis.fetch;
const envNames = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"] as const;
const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of envNames) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
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

test("one model call produces a validated question and saves a curriculum-only trace", async () => {
  credentials();
  const question = {
    prompt: "State the function of the nucleus.",
    marks: 1,
    answer_type: "short" as const,
    mark_scheme: "Contains genetic material that controls cell activities (1).",
    assessment_objectives: ["AO1"],
    mathematical_demand: false,
    practical_demand: false,
  };
  let modelCalls = 0;
  let trace: Record<string, unknown> | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const body = await request.json();
    if (request.url.includes("/v1/messages")) {
      modelCalls++;
      expect(body.output_config.format.type).toBe("json_schema");
      expect(body.messages[0].content).toContain("Functions of cell structures");
      return Response.json({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        stop_reason: "end_turn",
        stop_sequence: null,
        content: [{ type: "text", text: JSON.stringify({ questions: [question] }) }],
        usage: { input_tokens: 1000, output_tokens: 100 },
      });
    }
    trace = body;
    return new Response(null, { status: 201 });
  }) as unknown as typeof fetch;
  expect(await generateExamQuestions(context, 1, "written")).toEqual([question]);
  expect(modelCalls).toBe(1);
  expect(trace?.grounding).toBe("curriculum_only");
  expect(trace?.exemplar_ids).toEqual([]);
  expect(trace?.generated_questions).toEqual([question]);
});

test("truncated output cannot be returned to students or saved as a completed generation", async () => {
  credentials();
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return Response.json({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      stop_reason: "max_tokens",
      stop_sequence: null,
      content: [{ type: "text", text: '{"questions":[]}' }],
      usage: { input_tokens: 1000, output_tokens: 100 },
    });
  }) as unknown as typeof fetch;
  await expect(generateExamQuestions(context, 5, "written")).rejects.toThrow("did not complete");
  expect(requests).toBe(1);
});
