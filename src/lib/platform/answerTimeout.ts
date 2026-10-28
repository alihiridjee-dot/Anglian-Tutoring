/**
 * A database or sign-in request that never answers.
 *
 * Nothing in the browser puts a limit on a fetch. On a network that takes the
 * connection and then goes quiet (school Wi-Fi behind a filter, a train), a
 * read or a save waits for as long as the connection stays open, which can be
 * minutes, and the page shows its spinner or "Saving…" all that time. This
 * gives up when no answer has started to arrive in `NO_ANSWER_MS`, and fails
 * the way a dropped connection does, so the page's own "couldn't reach the
 * server" shows with its Try again, and the usual retries apply.
 *
 * Only the wait for an answer is timed, not the download: a long page of notes
 * on a slow phone connection is still arriving, not stuck. And only database
 * (`/rest/v1/`) and sign-in (`/auth/v1/`) requests: the database stops a
 * signed-in user's statement after 8 seconds anyway, so 10 (8, and room for
 * the trip) cuts off nothing it would have answered. Uploads (`/storage/v1/`)
 * and edge functions (`/functions/v1/`, where marking can take minutes) are
 * left alone.
 *
 * The limit is per try, not per read. The database client tries a read four
 * times on a dropped connection (waiting 1, 2 and 4 s between), and React
 * Query once more, so a read on a dead connection gives up after about 95 s
 * (2 × (4 × 10 + 7) + 1), not 10. A save is tried once.
 */
export const NO_ANSWER_MS = 10_000;

const TIMED = /\/(rest|auth)\/v1\//;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function withAnswerTimeout(fetcher: typeof fetch, ms = NO_ANSWER_MS): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!TIMED.test(urlOf(input))) return fetcher(input, init);

    const controller = new AbortController();
    // The caller's own cancel (React Query's, or supabase-js's) still works,
    // during the wait and while the body downloads.
    const caller = init?.signal;
    if (caller) {
      if (caller.aborted) controller.abort(caller.reason);
      else caller.addEventListener("abort", () => controller.abort(caller.reason), { once: true });
    }
    // Said in the words describeError already reads as a dropped connection,
    // and not an AbortError, which the database client reports as a deliberate
    // cancel and never retries.
    const timer = setTimeout(
      () => controller.abort(new TypeError(`Network request failed: no answer in ${ms / 1000} s`)),
      ms,
    );
    return fetcher(input, { ...init, signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
  }) as typeof fetch;
}
