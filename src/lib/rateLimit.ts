/**
 * A small in-memory sliding-window limiter for endpoints that have no signed-in
 * caller to attribute a quota to.
 *
 * `lib/ai/throttle.ts` solves the authenticated version of this problem in the
 * database, keyed on `auth.uid()`, which is durable across serverless instances.
 * That is not available here: the demo sales chat is deliberately session-less,
 * so there is no user id to count against and the only identifier is a client
 * IP the caller can rotate.
 *
 * So this is best-effort by construction, and worth having anyway. What it
 * actually stops is the realistic failure: a double-clicked send button, a
 * retry loop, a single script pointed at the endpoint. What it does not stop is
 * a distributed flood — nothing at this layer would, and the endpoint is built
 * so that a flood costs the business a bounded number of WhatsApp messages
 * rather than an unbounded one (see the global cap on the send itself).
 *
 * Entries are pruned on write, so the map cannot grow without bound on a
 * long-lived instance.
 */

type Window = { hits: number[] };

const buckets = new Map<string, Window>();

/** Stop tracking keys nobody has used for a while. */
const SWEEP_EVERY = 500;
let writes = 0;

function sweep(now: number, windowMs: number): void {
  for (const [key, w] of buckets) {
    const live = w.hits.filter((t) => now - t < windowMs);
    if (live.length === 0) buckets.delete(key);
    else w.hits = live;
  }
}

export interface LimitResult {
  ok: boolean;
  /** Seconds until the caller may retry — 0 when allowed. */
  retryAfter: number;
}

/**
 * Record one hit against `key` and report whether it was within the limit.
 *
 * A rejected hit is NOT recorded, so a caller who backs off recovers on
 * schedule instead of being held out indefinitely by their own retries.
 */
export function takeToken(key: string, limit: number, windowMs: number): LimitResult {
  const now = Date.now();

  if (++writes % SWEEP_EVERY === 0) sweep(now, windowMs);

  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0] ?? now;
    return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, retryAfter: 0 };
}

/** Clear all windows — tests only. */
export function __resetRateLimitForTests(): void {
  buckets.clear();
  writes = 0;
}
