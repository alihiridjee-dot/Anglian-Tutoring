/** The most subjects any single plan covers (Combined Trilogy = 3). */
export const PLAN_MAX_SUBJECTS = 3;

export type Cadence = "weekly" | "monthly" | "termly";

/** Billing cadences of the `${cadence}_${count}` tier matrix, in display order. */
export const CADENCES: { key: Cadence; label: string; unit: string }[] = [
  { key: "weekly", label: "Weekly", unit: "per week" },
  { key: "monthly", label: "Monthly", unit: "per month" },
  { key: "termly", label: "Termly", unit: "per term" },
];

/**
 * Weeks in one billing cycle, for every per-week and per-session figure.
 * Counted the landing page's way — 4 a month, 12 a term — so the landing page,
 * the plan step and Billing all quote the same number.
 */
export const WEEKS_PER_CYCLE: Record<Cadence, number> = { weekly: 1, monthly: 4, termly: 12 };

export type SubjectCount = 1 | 2 | 3;

/** What one plan costs per cycle, in pence, by cadence and subject count. */
export type PriceLadder = Record<Cadence, Record<SubjectCount, number>>;

/**
 * The prices the public pricing section shows and scripts/stripe-seed.ts makes
 * Stripe charge. packages.price_pence and the Stripe prices carry the same
 * numbers; Stripe prices never change, so editing a number here means a new
 * Stripe price (see docs/STRIPE_SETUP.md), not just a new figure on the page.
 *
 * GCSE, Combined Trilogy and International GCSE share the general ladder
 * (iGCSE has its own Stripe prices at the same amounts).
 */
export const GENERAL_PRICE_PENCE: PriceLadder = {
  weekly: { 1: 1999, 2: 2239, 3: 2399 },
  monthly: { 1: 4999, 2: 5599, 3: 5999 },
  termly: { 1: 13999, 2: 15699, 3: 16799 },
};

/** A-level: 10% above the general ladder, to the nearest penny (8 Nov 2026). */
export const ALEVEL_PRICE_PENCE: PriceLadder = {
  weekly: { 1: 2199, 2: 2463, 3: 2639 },
  monthly: { 1: 5499, 2: 6159, 3: 6599 },
  termly: { 1: 15399, 2: 17269, 3: 18479 },
};

/** The ladder a curriculum level is sold at; KS3 and everything else use the general one. */
export function priceLadderFor(level: string | null | undefined): PriceLadder {
  return level === "alevel" ? ALEVEL_PRICE_PENCE : GENERAL_PRICE_PENCE;
}

/** A cycle's price spread over its weeks, in pence. */
export function pricePerWeek(cadence: Cadence, pence: number): number {
  return pence / WEEKS_PER_CYCLE[cadence];
}

/**
 * The one cadence every page labels "Best value": the cheapest per week at
 * every subject count (entitlements.test.ts checks it against live prices).
 */
export const BEST_VALUE_CADENCE: Cadence = "termly";
export const BEST_VALUE_LABEL = "Best value";

/**
 * How many subjects a plan tier covers. Tiers are `${cadence}_${count}` (e.g.
 * "monthly_2"), so the count is the trailing number; anything unparseable falls
 * back to 1 so a live plan never reads as covering zero subjects.
 */
export function planSubjectCount(tier: string | null | undefined): number {
  const n = Number(String(tier ?? "").split("_")[1]);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, PLAN_MAX_SUBJECTS);
}

/** The billing cadence a tier belongs to, or null if it isn't one of ours. */
export function planCadence(tier: string | null | undefined): Cadence | null {
  const head = String(tier ?? "").split("_")[0];
  return CADENCES.some((c) => c.key === head) ? (head as Cadence) : null;
}

/** The tier id for a cadence at a given subject count. */
export function tierFor(cadence: Cadence, count: number): string {
  return `${cadence}_${Math.min(Math.max(count, 1), PLAN_MAX_SUBJECTS)}`;
}
