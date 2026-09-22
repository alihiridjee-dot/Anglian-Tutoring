import { isHandPicked, type PointOrigin } from "./admissibility";

/**
 * Tutor overrides — the one rule for how a person's decision and the
 * programme's decision combine for a spec point in a week.
 *
 * Before this module, a tutor's only lasting mark on a plan was a plan-point row
 * with a hand-picked origin. That covers *adding* work: `save_weekly_plan` and
 * `mergeWeek` both keep hand-picked rows through a re-cut. It did not cover
 * *removing* work. Deleting an automatic row left nothing behind to say the
 * tutor had chosen against it, so the next cut — the student opening the week,
 * a catch-up top-up, a topic reorder — put the point straight back. The tutor's
 * edit was overwritten by the scheduler, silently, every time.
 *
 * An override is that missing record. There are two kinds:
 *
 *  • `remove` — this point may not be *scheduled* into this one week.
 *  • `skip`   — this point may not be scheduled into any week: the student has
 *               done it at school, it is not on their tier, the tutor has
 *               decided it is not worth the time.
 *
 * Both bind the programme, never the person. The precedence, highest first:
 *
 *  1. **Pinned** — a plan-point row with a hand-picked origin. Always in the
 *     week. A tutor who pins a point they had skipped has changed their mind
 *     about *this week*, and the pin says so.
 *  2. **Removed** — a `remove` override for (point, week). No automatic lane
 *     may fill that week with it; a review due then waits for the next opening.
 *  3. **Skipped** — a `skip` override for the point. No automatic lane may fill
 *     any week with it, and the backlog does not chase it.
 *  4. **Automatic** — whatever the spine, catch-up and review lanes select.
 *
 * Student work is a separate axis and outranks all four: a point with a
 * submission, an attempt or a tick in the week is never deleted by a removal
 * (`remove_plan_point` refuses, and `save_weekly_plan` protects it as before).
 * Overrides shape what is *assigned*, not what was *done*.
 *
 * Pure — no I/O — so the week cut, the roadmap projection, the catch-up
 * trickle and the tutor's screen all give the same answer. The database holds
 * the same rule in `enforce_plan_overrides`, so an older client cannot write
 * around it.
 */

/** Mirrors the `plan_override_kind` enum, structurally, to stay dependency-free. */
export type PlanOverrideKind = "remove" | "skip";

export interface PlanOverride {
  id: string;
  specPointId: string;
  kind: PlanOverrideKind;
  /** Monday date-key for a `remove`; null for a `skip`. */
  weekStart: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** Fast lookups over a student's overrides for one subject. */
export interface OverrideIndex {
  /** Spec points a `skip` covers. */
  skipped: ReadonlySet<string>;
  /** Spec point → the Monday date-keys a `remove` covers. */
  removed: ReadonlyMap<string, ReadonlySet<string>>;
  /** The override that keeps this point out of this week, or null. */
  blocking(specPointId: string, weekStart: string): PlanOverride | null;
}

const NONE: OverrideIndex = {
  skipped: new Set(),
  removed: new Map(),
  blocking: () => null,
};

export function indexOverrides(overrides: readonly PlanOverride[] | undefined): OverrideIndex {
  if (!overrides || overrides.length === 0) return NONE;
  const skipped = new Map<string, PlanOverride>();
  const removed = new Map<string, Map<string, PlanOverride>>();
  for (const o of overrides) {
    if (o.kind === "skip") {
      skipped.set(o.specPointId, o);
    } else if (o.weekStart) {
      const weeks = removed.get(o.specPointId) ?? new Map<string, PlanOverride>();
      weeks.set(o.weekStart, o);
      removed.set(o.specPointId, weeks);
    }
  }
  return {
    skipped: new Set(skipped.keys()),
    removed: new Map([...removed].map(([id, weeks]) => [id, new Set(weeks.keys())])),
    // A week-level removal is the more specific statement, so it is the one
    // reported when both apply.
    blocking: (specPointId, weekStart) =>
      removed.get(specPointId)?.get(weekStart) ?? skipped.get(specPointId) ?? null,
  };
}

/**
 * May the programme put this point into this week?
 *
 * Hand-picked origins are exempt — that is the pin outranking the override.
 * Everything automatic (`core`, `focus`, `ai`, legacy `carried_over`) is bound.
 */
export function programmeMayAssign(
  index: OverrideIndex,
  point: { specPointId: string; origin?: PointOrigin },
  weekStart: string,
): boolean {
  if (point.origin && isHandPicked(point.origin)) return true;
  return index.blocking(point.specPointId, weekStart) === null;
}

/**
 * A `(specPointId, weekKey) => boolean` for the projections that place work
 * across weeks — reviews and catch-up — so a removed week is passed over and
 * a skipped point never lands anywhere.
 */
export function blockedBy(
  index: OverrideIndex,
): (specPointId: string, weekStart: string) => boolean {
  return (specPointId, weekStart) => index.blocking(specPointId, weekStart) !== null;
}

/** One point the rule kept out of a week, and the override that did it. */
export interface Suppressed {
  specPointId: string;
  override: PlanOverride;
}

/**
 * Apply the rule to a cut week: automatic points the tutor has removed from
 * this week or skipped altogether come out; hand-picked ones stay. Returns the
 * kept selection and what was suppressed, so nothing is dropped unreported.
 */
export function applyOverrides<
  T extends { specPointIds: string[]; origins: Record<string, PointOrigin> },
>(
  selection: T,
  index: OverrideIndex,
  weekStart: string,
): { selection: T; suppressed: Suppressed[] } {
  const suppressed: Suppressed[] = [];
  const specPointIds: string[] = [];
  const origins: Record<string, PointOrigin> = {};
  for (const id of selection.specPointIds) {
    const origin = selection.origins[id];
    if (programmeMayAssign(index, { specPointId: id, origin }, weekStart)) {
      specPointIds.push(id);
      if (origin) origins[id] = origin;
    } else {
      suppressed.push({ specPointId: id, override: index.blocking(id, weekStart)! });
    }
  }
  if (suppressed.length === 0) return { selection, suppressed };
  return { selection: { ...selection, specPointIds, origins }, suppressed };
}

/** The `remove` overrides that name one week, and the `skip`s, for display. */
export function overridesForWeek(
  overrides: readonly PlanOverride[],
  weekStart: string,
): { removed: PlanOverride[]; skipped: PlanOverride[] } {
  return {
    removed: overrides.filter((o) => o.kind === "remove" && o.weekStart === weekStart),
    skipped: overrides.filter((o) => o.kind === "skip"),
  };
}
