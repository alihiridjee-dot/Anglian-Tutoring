import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { drawFigure } from "./drawFigure.server";
import { FIGURE_EXAMPLES } from "./figurePrompt";

const [, series] = FIGURE_EXAMPLES;
const request = {
  subject: "physics",
  question: series.request.question,
  brief: series.request.brief,
};
const originalFetch = globalThis.fetch;
const restore: { mockRestore(): void }[] = [];
beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = "deepseek-test";
  restore.push(spyOn(console, "log").mockImplementation(() => {}));
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.DEEPSEEK_API_KEY;
  restore.splice(0).forEach((spy) => spy.mockRestore());
});

/** DeepSeek behind fetch: each call takes the next answer, or throws it. */
function deepseek(...answers: (Error | unknown)[]) {
  let calls = 0;
  globalThis.fetch = (async () => {
    const answer = answers[calls++];
    if (answer instanceof Error) throw answer;
    return Response.json({
      choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 7000, completion_tokens: 2000 },
    });
  }) as unknown as typeof fetch;
  return () => calls;
}
const timeout = () =>
  Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });

test("a call that times out gets the other try", async () => {
  const calls = deepseek(timeout(), series.reply);
  const drawn = await drawFigure(request, Date.now() + 200_000);
  expect(calls()).toBe(2);
  expect(drawn).toMatchObject({ ok: { brief: { drawn_by: "deepseek" } } });
});

test("two timeouts, or no time left for another try, leave the figure undrawn", async () => {
  deepseek(timeout(), timeout());
  expect(await drawFigure(request, Date.now() + 200_000)).toEqual({
    failed: "DeepSeek call failed: The operation timed out.",
  });
  // The first call runs its 15 s out, leaving 15 s: nothing starts with under 20 s to go.
  let now = Date.now();
  restore.push(spyOn(Date, "now").mockImplementation(() => now));
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    now += 15_000;
    throw timeout();
  }) as unknown as typeof fetch;
  const drawn = await drawFigure(request, now + 30_000);
  expect(calls).toBe(1);
  expect(drawn).toEqual({ failed: "out of time: timed out after 25 s" });
});

test("whatever the checking trips on costs the figure, never the set", async () => {
  // Not JSON at all, twice: the question is left out, nothing is thrown.
  globalThis.fetch = (async () =>
    Response.json({ choices: [{ message: { content: "<svg" } }] })) as unknown as typeof fetch;
  const drawn = await drawFigure(request, Date.now() + 200_000);
  expect("failed" in drawn).toBe(true);
});
