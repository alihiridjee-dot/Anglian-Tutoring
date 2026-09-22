import { customSchedule } from "./topicOrder";
import { isTeachBand, selectWeekPoints, withWeeklyPoints } from "./pacing";
import { hasStudentHistory } from "./admissibility";
import { catchUpBudget, trickle } from "./backlog";
import { applyOverrides, indexOverrides } from "./overrides";
import { type PointCoverage } from "./coverage";
import { type PlanPoint, type PlanPointOrigin, type WithheldPlanPoint } from "./weeklyPlanDal";
import { focusInputs, type RoadmapResult } from "./roadmap";

/**
 * The pure half of cutting a week: choosing its points from the roadmap, and
 * merging a fresh cut into what a saved week already holds. Nothing here reads
 * or writes; `ProgramDAL.planForWeek` and `ProgramDAL.refreshWeek` do the I/O
 * around these.
 */

/** "a", "a and b", "a, b and c" — for the plan's one-line rationale. */
function listSentence(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Was this point put in the week by a person rather than by the programme?
 *
 * The two hand-picked origins are the student's own additions and the tutor's
 * ({@link TutorPlannerPanel} writes `tutor`). They behave identically on a
 * re-cut — see {@link mergeWeek} — because the distinction that
 * matters there is "the programme did not choose this, so it does not get to
 * un-choose it", and that is equally true of both.
 */
export function handPicked(origin: PlanPointOrigin): boolean {
  return origin === "student" || origin === "tutor";
}

/** What a week is cut to: its points, the lane each was chosen for, and why. */
export interface WeekSelection {
  specPointIds: string[];
  /** Spec-point id → `core` or `focus`, persisted as the point's origin. */
  origins: Record<string, PlanPointOrigin>;
  rationale: string;
}

const emptyWeek = (): WeekSelection => ({ specPointIds: [], origins: {}, rationale: "" });

/**
 * Fixed teaching and assessed reviews for one week of the programme. Empty weeks
 * stay empty: past the exam, before any curriculum exists, or when the spine has
 * nothing outstanding in that week.
 */
export function selectWeek(roadmap: RoadmapResult | null, weekStart: string): WeekSelection {
  if (roadmap) {
    if (weekStart >= roadmap.examDate) return emptyWeek();
    // Only what was promised strictly before the week being cut: the roadmap
    // measures the backlog from today, and a week planned further ahead has
    // not yet passed the weeks between.
    //
    // Both fields are tolerated as absent because the roadmap can be handed in
    // by a caller rather than loaded here. Catching up is an addition to the
    // week, so a roadmap that cannot describe the debt yields no catch-up
    // rather than no week.
    const due = (roadmap.backlog ?? []).filter((b) => b.plannedWeek < weekStart);
    const take = roadmap.catchUpSchedule
      ? (roadmap.catchUpSchedule.weeks[weekStart] ?? []).filter((p) =>
          due.some((b) => b.specPointId === p.specPointId),
        )
      : trickle(due, catchUpBudget(roadmap.focusLoad?.spine ?? 0)).take;
    const { specPointIds, lanes, teachTitle, focusCount, teachCount, catchUpIds, catchUpTopics } =
      selectWeekPoints({
        bands: [
          ...withWeeklyPoints(
            roadmap.baselineBands,
            new Map(
              roadmap.progress.map((t) => [
                t.topicId,
                t.points.map((p) => ({
                  specPointId: p.id,
                  code: p.code,
                  title: p.title,
                  weight: p.weight,
                })),
              ]),
            ),
          ),
          ...roadmap.bands.filter((b) => !isTeachBand(b)),
        ],
        weekStart,
        topics: customSchedule(roadmap.baselineBands)
          ? roadmap.progress.map((t) => ({
              ...t,
              points: t.points.map((p) => ({
                ...p,
                reps: roadmap.completedPointIds?.includes(p.id) ? Math.max(1, p.reps) : p.reps,
              })),
            }))
          : roadmap.progress,
        catchUp: take.map((b) => ({
          specPointId: b.specPointId,
          topicTitle: b.topicTitle,
          weight: b.weight,
        })),
      });
    /**
     * The tutor's overrides are the last word on an automatic selection: a
     * point removed from this week or skipped in the programme comes out here
     * ([[overrides]]). The lanes above already project around them — a review
     * or a catch-up point steps past a closed week — so this is the guard for
     * the one lane that cannot, the fixed teaching slice, and for any caller
     * that hands in a roadmap built without them.
     */
    const { selection: allowed, suppressed } = applyOverrides(
      { specPointIds, origins: lanes },
      indexOverrides(roadmap.overrides),
      weekStart,
    );
    const kept = new Set(allowed.specPointIds);
    const keptCatchUp = catchUpIds.filter((id) => kept.has(id));
    const keptFocus =
      focusCount - suppressed.filter((s) => lanes[s.specPointId] === "focus").length;
    const keptTeach =
      teachCount -
      suppressed.filter(
        (s) => lanes[s.specPointId] === "core" && !catchUpIds.includes(s.specPointId),
      ).length;
    if (allowed.specPointIds.length === 0) {
      // The programme covers this week and has nothing outstanding in it. A
      // real answer, and the week's own copy says it far better than six
      // points picked for no stated reason would.
      return emptyWeek();
    }
    const parts: string[] = [];
    if (keptFocus > 0) parts.push(`${keptFocus} to revisit`);
    if (keptTeach > 0) parts.push(`${keptTeach} from this week's topic (${teachTitle})`);
    if (keptCatchUp.length > 0)
      parts.push(`${keptCatchUp.length} catching up on ${listSentence(catchUpTopics)}`);
    // Naming the rest of the backlog is the point: the student is told the
    // debt exists and is being worked through, rather than meeting it as
    // unexplained old material appearing in their week for months.
    const remaining = due.length - keptCatchUp.length;
    const chasing =
      remaining > 0
        ? ` ${remaining} more missed ${remaining === 1 ? "point is" : "points are"} queued for the weeks after this one.`
        : "";
    const overridden =
      suppressed.length > 0
        ? ` Your tutor has set ${suppressed.length} ${suppressed.length === 1 ? "point" : "points"} aside.`
        : "";
    return {
      specPointIds: allowed.specPointIds,
      origins: allowed.origins,
      rationale: `From your programme: ${listSentence(parts)}. Reviews follow assessed practice and are assigned when eligible.${chasing}${overridden}`,
    };
  }

  // No curriculum means there is no work to allocate.
  return emptyWeek();
}

/** A saved week as `WeeklyPlanDAL.getPlan` reads it back. */
export type SavedWeekPoints = { points: PlanPoint[]; withheld: WithheldPlanPoint[] };

/**
 * The reviews a saved week holds that nothing assessed stands behind, and the
 * ones already quarantined for it. A repair turns these into teaching.
 */
export function unsupportedReviews(existing: SavedWeekPoints, roadmap: RoadmapResult | null) {
  const assessed = new Set(
    focusInputs(roadmap?.progress ?? []).candidates.map((p) => p.specPointId),
  );
  const unsupported = (p: PlanPoint) => p.origin === "focus" && !assessed.has(p.spec_point_id);
  /**
   * Reviews quarantined for having nothing behind them, which the repair is
   * about to turn into teaching.
   *
   * Since [[admissibility]], `getPlan` splits a saved week into `points` and
   * `withheld`, and a `focus` point with no assessed evidence is precisely
   * what lands in the second — so a repair that only scanned `points` would
   * find nothing to do and quietly no-op. Only `no-evidence` is pulled back:
   * a point withheld as ahead-of-spine or off-course has a different problem,
   * and relabelling its lane would not fix it.
   */
  const quarantined = existing.withheld
    .filter((w) => w.reason === "no-evidence")
    .map((w) => w.point);
  const saved = [...existing.points, ...quarantined];
  return { unsupported, quarantined, saved };
}

/** What a re-cut writes back, or null when the saved week already says this. */
export interface MergedWeek {
  specPointIds: string[];
  origins: Record<string, PlanPointOrigin>;
  carriedFroms: Record<string, string | null>;
}

/**
 * Merge a fresh cut into a saved week: hand-picked and touched work survives,
 * stale automatic work is replaced, and a repair re-admits quarantined reviews
 * as teaching. Throws when the caller's preview no longer matches.
 */
export function mergeWeek(params: {
  existing: SavedWeekPoints;
  fresh: WeekSelection;
  coverage: Map<string, PointCoverage>;
  roadmap: RoadmapResult | null;
  repair: Pick<ReturnType<typeof unsupportedReviews>, "unsupported" | "quarantined">;
  repairUnsupportedReviews?: boolean;
  expectedPointIds?: string[];
}): MergedWeek | null {
  const { existing, fresh, coverage, roadmap } = params;
  const { unsupported, quarantined } = params.repair;

  // Completed attempts remain visible too: re-planning must not erase progress.
  const inFlight = (id: string): boolean => !!coverage.get(id)?.attempted;
  /**
   * What survives the re-cut: hand-picked work, anything the student has
   * touched, and — when repairing — the quarantined reviews themselves.
   *
   * Withheld history is normally left alone, because resubmitting it would
   * just re-trigger admission and it is preserved by `save_weekly_plan`
   * regardless. A `no-evidence` review is the exception the repair exists
   * for: it is re-admitted deliberately, and only because its lane is about
   * to change to `core` below, which is a lane the rule accepts.
   */
  const keep = [
    // The original rule, unchanged: an active point survives a re-cut only if
    // a person chose it or the student has touched it. A stale automatic
    // review with no history is still dropped and re-selected from scratch.
    ...existing.points.filter(
      (p) =>
        handPicked(p.origin) || hasStudentHistory({ ...p, attempted: inFlight(p.spec_point_id) }),
    ),
    // Quarantined reviews are the addition, and they come back regardless of
    // history: having none is the whole reason they were withheld.
    ...(params.repairUnsupportedReviews ? quarantined : []),
  ];

  // Kept points first so their original lane wins the merge. Both planners
  // label every point they return, so the default below is unreachable — it is
  // `ai` ("generated, lane unknown") rather than `focus` because guessing
  // `focus` is exactly how a point the student never flagged ends up presented
  // to them as revision.
  const origins: Record<string, PlanPointOrigin> = {};
  // Carry markers ride along too — `savePlan` rewrites the point set wholesale,
  // so anything not handed back here is lost.
  const carriedFroms: Record<string, string | null> = {};
  for (const p of keep) {
    origins[p.spec_point_id] = roadmap && unsupported(p) ? "core" : p.origin;
    carriedFroms[p.spec_point_id] = p.carried_from;
  }
  for (const id of fresh.specPointIds) origins[id] ??= fresh.origins[id] ?? "ai";
  const specPointIds = Object.keys(origins);
  if (
    params.expectedPointIds &&
    (params.expectedPointIds.length !== specPointIds.length ||
      specPointIds.some((id) => !params.expectedPointIds!.includes(id)))
  ) {
    throw new Error(
      "Your assessment results or assignments changed. Preview the updated week again before applying it.",
    );
  }

  const before = new Set(existing.points.map((p) => p.spec_point_id));
  // Three independent reasons to write. The point set differing is the
  // obvious one; a point keeping its id while its *lane* was repaired is
  // Codex's case; and a week still holding withheld rows must be re-saved so
  // they are cleared, which is why an unchanged set is not enough on its own.
  const unchanged =
    specPointIds.length === before.size &&
    specPointIds.every((id) => before.has(id)) &&
    existing.points.every((p) => origins[p.spec_point_id] === p.origin);
  if (unchanged && existing.withheld.length === 0) return null;
  return { specPointIds, origins, carriedFroms };
}
