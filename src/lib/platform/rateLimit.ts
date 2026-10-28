/**
 * A small in-memory sliding-window limiter for endpoints that have no signed-in
 * caller to attribute a quota to.
 *
 * The authenticated version of this problem used to be solved in the database,
 * keyed on `auth.uid()` and durable across serverless instances. Either way it
 * is not available here: the demo sales chat is deliberately session-less, so
 * there is no user id to count against and the only identifier is a client IP
 * the caller can rotate.
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

/** A key's recent hits, and the window they count over. */
type Window = { hits: number[]; windowMs: number };

const buckets = new Map<string, Window>();

/** Stop tracking keys nobody has used for a while. */
const SWEEP_EVERY = 500;
let writes = 0;

/**
 * Each bucket is pruned by its own window. Pruning every bucket by the calling
 * request's window let a 10-minute contact-form call trim the hour-long
 * WhatsApp budget, so that budget forgot hits it should still count.
 */
function sweep(now: number): void {
  for (const [key, w] of buckets) {
    const live = w.hits.filter((t) => now - t < w.windowMs);
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
  return takeTokens([{ key, limit, windowMs }]);
}

/** One limit a hit counts against. */
export interface Gate {
  key: string;
  limit: number;
  windowMs: number;
}

/**
 * One hit against several limits at once: it is recorded against all of them,
 * or, when any one is full, against none, so a refused hit leaves nothing
 * behind, not even a new key.
 */
export function takeTokens(gates: readonly Gate[]): LimitResult {
  const now = Date.now();

  if (++writes % SWEEP_EVERY === 0) sweep(now);

  const live = gates.map((g) => ({
    ...g,
    hits: (buckets.get(g.key)?.hits ?? []).filter((t) => now - t < g.windowMs),
  }));

  const waits = live
    .filter((g) => g.hits.length >= g.limit)
    .map((g) => Math.ceil((g.windowMs - (now - (g.hits[0] ?? now))) / 1000));
  if (waits.length > 0) return { ok: false, retryAfter: Math.max(1, ...waits) };

  for (const g of live) buckets.set(g.key, { hits: [...g.hits, now], windowMs: g.windowMs });
  return { ok: true, retryAfter: 0 };
}

/** A dotted IPv4 address, each part 0 to 255. */
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/**
 * The address as a limiter key, or null when it doesn't read as one. An IPv6
 * visitor is counted by their /64, the block one home line is given, since
 * any address inside it is theirs to use.
 */
function addressKey(raw: string): string | null {
  if (raw.length > 45) return null;
  if (IPV4.test(raw)) return raw;
  if (!/^[0-9a-f:]+$/i.test(raw)) return null;
  const halves = raw.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const gap = 8 - head.length - tail.length;
  if (halves.length === 2 ? gap < 1 : gap !== 0) return null;
  const groups = [...head, ...Array<string>(Math.max(gap, 0)).fill("0"), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const prefix = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, ""));
  return `${prefix.join(":")}::/64`;
}

/**
 * Who a public form's hits count against.
 *
 * The site sits behind Cloudflare, so the address Vercel puts in
 * `x-forwarded-for` is Cloudflare's, and many visitors share it: a few
 * strangers' enquiries could use up the next visitor's limit. Cloudflare
 * passes the visitor's own address in `cf-connecting-ip`, so `visitor` is
 * that, when it reads as an address. It is a hint, not proof, so `hop`, the
 * address that actually connected, keeps a looser limit of its own. With
 * nothing to go on, every caller shares one bucket, which is the strict
 * direction to fail in.
 */
export function requestAddresses(headers: Headers | null | undefined): {
  visitor: string;
  hop: string;
} {
  const hop =
    headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers?.get("x-real-ip")?.trim() ||
    "unknown";
  const visitor = addressKey(headers?.get("cf-connecting-ip")?.trim() ?? "");
  return { visitor: visitor ?? hop, hop };
}

/** "5 minutes", from a refusal's seconds to wait. */
export function retryWait(retryAfter: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** Clear all windows — tests only. */
export function __resetRateLimitForTests(): void {
  buckets.clear();
  writes = 0;
}
