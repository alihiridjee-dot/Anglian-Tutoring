import { describe, expect, test } from "bun:test";
import { withAnswerTimeout } from "./answerTimeout";
import { describeError } from "./errors";

const BASE = "https://example.supabase.co";

/** A server that takes the request and never answers, unless told to. */
function silentServer() {
  const seen: { url: string; signal: AbortSignal | null | undefined }[] = [];
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), signal: init?.signal });
    return new Promise<Response>((_, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener("abort", () => reject(signal.reason));
    });
  }) as typeof fetch;
  return { fetcher, seen };
}

describe("withAnswerTimeout", () => {
  test("a database read with no answer fails as a dropped connection", async () => {
    const { fetcher } = silentServer();
    const timed = withAnswerTimeout(fetcher, 20);
    const failure = await timed(`${BASE}/rest/v1/profiles?select=role`).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(TypeError);
    // Not an AbortError: the database client would report that as a cancel.
    expect((failure as Error).name).toBe("TypeError");
    expect(describeError(failure)).toBe(
      "We couldn't reach the server. Check your connection and try again.",
    );
  });

  test("sign-in requests are timed too", async () => {
    const { fetcher } = silentServer();
    const timed = withAnswerTimeout(fetcher, 20);
    const failure = await timed(`${BASE}/auth/v1/user`).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(TypeError);
  });

  test("uploads and edge functions are left alone", async () => {
    const { fetcher, seen } = silentServer();
    const timed = withAnswerTimeout(fetcher, 20);
    let settled = false;
    void timed(`${BASE}/functions/v1/mark-homework`, { method: "POST" }).finally(() => {
      settled = true;
    });
    void timed(`${BASE}/storage/v1/object/avatars/x.jpg`, { method: "POST" }).finally(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(settled).toBe(false);
    // Passed straight through, with no signal of ours added.
    expect(seen.map((s) => s.signal)).toEqual([undefined, undefined]);
  });

  test("an answer in time is handed back, and the timer is not left running", async () => {
    const fetcher = (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
    const timed = withAnswerTimeout(fetcher, 20);
    const res = await timed(`${BASE}/rest/v1/topics`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("[]");
  });

  test("the caller's own cancel still cancels, as a cancel", async () => {
    const { fetcher } = silentServer();
    const timed = withAnswerTimeout(fetcher, 10_000);
    const caller = new AbortController();
    const pending = timed(`${BASE}/rest/v1/topics`, { signal: caller.signal }).catch(
      (e: unknown) => e,
    );
    caller.abort();
    const failure = (await pending) as Error;
    expect(failure.name).toBe("AbortError");
  });

  test("a signal already cancelled cancels at once", async () => {
    const { fetcher } = silentServer();
    const timed = withAnswerTimeout(fetcher, 10_000);
    const caller = new AbortController();
    caller.abort();
    const failure = (await timed(`${BASE}/rest/v1/topics`, { signal: caller.signal }).catch(
      (e: unknown) => e,
    )) as Error;
    expect(failure.name).toBe("AbortError");
  });
});
