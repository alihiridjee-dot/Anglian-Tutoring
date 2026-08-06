import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Keeping the AI endpoints inside their rate limits when a whole cohort is
 * online at once.
 *
 * The student-facing suggesters each send the course's full spec-point list to
 * Anthropic — a few thousand input tokens per call. Nothing capped how often a
 * student could ask, and nothing capped how many calls could be in flight
 * together. Fifty students opening the planner at the same time is fifty
 * simultaneous requests, which clears the per-minute token allowance
 * immediately; every one of them then fails, including the students who only
 * pressed the button once. A cohort-sized burst is not an unusual event either
 * — it is a Sunday evening.
 *
 * Two layers, because neither is sufficient alone:
 *
 *   • A per-user quota in the database ({@link claimRequest}). Durable across
 *     serverless instances, so it survives the process recycling that would
 *     quietly reset an in-memory counter. This is what stops one student (or a
 *     stuck retry loop) spending the whole allowance.
 *
 *   • A per-instance concurrency gate ({@link withConcurrencyLimit}). Shapes
 *     the burst: requests queue instead of arriving together, which is what the
 *     token-per-minute limit actually cares about.
 */

/** Simultaneous Anthropic calls allowed per server instance. */
const MAX_CONCURRENT = 4;
/** How long a queued request waits for a slot before giving up. */
const QUEUE_TIMEOUT_MS = 20_000;

let active = 0;
const waiting: Array<() => void> = [];

function release(): void {
  active -= 1;
  const next = waiting.shift();
  if (next) next();
}

/**
 * Run `fn` with at most {@link MAX_CONCURRENT} others in flight on this
 * instance. Queued callers are served in order; one that waits longer than
 * {@link QUEUE_TIMEOUT_MS} is rejected rather than left hanging behind a
 * pile-up, so the student gets a "try again" instead of a spinner that never
 * resolves.
 */
export async function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const i = waiting.indexOf(admit);
        if (i >= 0) waiting.splice(i, 1);
        reject(new Error("The planner is busy right now — try again in a moment."));
      }, QUEUE_TIMEOUT_MS);

      function admit() {
        if (settled) {
          // Timed out already; hand the slot straight to the next in line.
          release();
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve();
      }
      waiting.push(admit);
    });
  }
  active += 1;
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Per-endpoint quotas: how many calls one student may make per window. */
export const AI_QUOTAS = {
  "suggest-weekly-plan": { limit: 12, windowMinutes: 60 },
  "interpret-weakness": { limit: 20, windowMinutes: 60 },
} as const;

export type AiEndpoint = keyof typeof AI_QUOTAS;

/**
 * Claim one request against the caller's quota, throwing if they're over it.
 *
 * The check and the record happen in one database function, so two requests
 * racing can't both read the same remaining count and both proceed. A failure
 * to reach the database is allowed through — a throttle that takes the feature
 * down when the counter is unreachable is worse than the burst it prevents,
 * and the concurrency gate still applies.
 */
export async function claimRequest(
  supabase: SupabaseClient<Database>,
  endpoint: AiEndpoint,
): Promise<void> {
  const { limit, windowMinutes } = AI_QUOTAS[endpoint];
  const { data, error } = await supabase.rpc("claim_ai_request", {
    _endpoint: endpoint,
    _limit: limit,
    _window: `${windowMinutes} minutes`,
  });
  if (error) {
    console.error("AI throttle check failed, allowing through:", error.message);
    return;
  }
  if (data === false) {
    throw new Error(
      `You've used your ${limit} plan suggestions for this hour. Your plan is still there — you can edit it by hand, or come back shortly.`,
    );
  }
}

/**
 * Call Anthropic with the throttle applied and one backoff retry on a 429.
 *
 * The single retry is deliberate. Anthropic's own SDK already retries twice,
 * and under a cohort-sized burst every extra automatic retry is more load on
 * the limit that is already the problem — retries are what turn a brief spike
 * into a sustained one. One spaced retry absorbs a near-miss; anything past
 * that should surface to the student as "try again".
 */
export async function callWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
  return withConcurrencyLimit(async () => {
    try {
      return await fn();
    } catch (e) {
      if ((e as { status?: number })?.status !== 429) throw e;
      const retryAfter = Number(
        (e as { headers?: Record<string, string> })?.headers?.["retry-after"],
      );
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2_000;
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 10_000)));
      return await fn();
    }
  });
}

/** Reset the in-process gate — tests only. */
export function __resetConcurrencyForTests(): void {
  active = 0;
  waiting.length = 0;
}
