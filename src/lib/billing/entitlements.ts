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
