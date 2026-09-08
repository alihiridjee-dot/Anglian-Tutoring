import { isTeachBand, weightOf, type PacingBand } from "./pacing";

/**
 * The catch-up rule — what the programme scheduled, walked past, and never
 * covered.
 *
 * The spine is a promise: every spec point on the course is allocated to
 * exactly one week between enrolment and the exam ({@link withWeeklyPoints}).
 * Nothing in the engine ever checked whether that promise was kept. The two
 * lanes that fill a week both look forwards only:
 *
 *  • the teach lane ({@link selectWeekPoints}) reads `bandsForWeek(weekStart)`
 *    and takes that band's slice for *this* week, so once a band's last Monday
 *    passes, none of its points can ever be selected again;
 *  • the focus lane ({@link focusInputs}) requires `reps > 0`, and reps come
 *    from graded evidence, which a point nobody was ever offered cannot have.
 *
 * So a spec point missed in its own week fell out of the system permanently —
 * not withheld, not reported, simply unreachable. On the account this was found
 * on, 14 of Topic 1's 17 points had never appeared in a single weekly plan and
 * the topic's window had closed a month earlier.
 *
 * `splitAcrossWeeks` already documented this as somebody's job ("Catching up on
 * what was missed is the weekly view's job"). This module is that job, written
 * down: pure, no I/O, one definition of *passed over* and one of *how much of
 * it a week may carry*.
 *
 * Deliberately NOT a judgement about whether the student is behind. It answers
 * "which points did the programme promise and not deliver", and leaves what to
 * do about that to the caller. See [[admissibility]] for the sibling rule
 * governing what may be *assigned*; a backlog point always satisfies it,
 * because its topic opened in the past.
 */

/** A spine point whose scheduled week has passed with nothing to show for it. */
export interface BacklogPoint {
  specPointId: string;
  topicId: string;
  topicTitle: string;
  code: string;
  title: string;
  /** Its share of a week's work — see `spec_points.weight`. 1 when unmeasured. */
  weight: number;
  /** The Monday the spine originally allocated it to. */
  plannedWeek: string;
}

/**
 * What counts as *delivered*, so the caller and this module cannot disagree.
 *
 * A point leaves the backlog three ways, and all three are things that already
 * happened rather than intentions:
 *
 *  • **assessed** — there is graded evidence behind it, so FSRS owns it now and
 *    the focus lane will bring it back on its own schedule;
 *  • **done** — the student ticked it off in some week;
 *  • **outstanding** — it is already sitting in a *later* week's plan, so it has
 *    not been passed over, it just has not come round yet.
 *
 * Merely having been *offered* is not delivery, and that includes the week now
 * being cut: a point appearing in a plan the student never opened is exactly
 * the case this module exists for, and treating an untouched offer as covered
 * would let the engine discharge its promise by having made it once. It is also
 * why `outstanding` stops short of the current week — see
 * {@link WeeklyPlanDAL.getDeliveryLedger}, where counting it would make a
 * re-cut drop the catch-up point and the next cut put it back.
 */
export interface DeliveryLedger {
  /** Points with assessed evidence — FSRS is already scheduling these. */
  assessed: ReadonlySet<string>;
  /** Points the student ticked off in any week. */
  done: ReadonlySet<string>;
  /** Points already sitting in a plan for a week after the one being cut. */
  outstanding: ReadonlySet<string>;
}

/** Has this point been dealt with by any of the three routes? */
export function isDelivered(specPointId: string, ledger: DeliveryLedger): boolean {
  return (
    ledger.assessed.has(specPointId) ||
    ledger.done.has(specPointId) ||
    ledger.outstanding.has(specPointId)
  );
}

/**
 * Every spec point the spine allocated to a week before `weekStart` that the
 * ledger cannot account for, oldest first.
 *
 * Reads `pointsByWeek`, which is the same weighted division the roadmap renders
 * and the teach lane selects from ({@link withWeeklyPoints}), so a point is
 * chased in exactly the week the student was shown it would come up. Bands
 * stored before `pointsByWeek` existed carry no division; those fall back to
 * the band's start week, which is the earliest week any of its points could
 * honestly be said to have been due.
 */
export function spineBacklog(params: {
  /** The acknowledged spine, hydrated by {@link withWeeklyPoints}. */
  bands: PacingBand[];
  /** Monday date-key of the week being planned. Earlier weeks have passed. */
  weekStart: string;
  ledger: DeliveryLedger;
  /** Topic id → its points, for bands with no stored weekly division. */
  pointsByTopic?: ReadonlyMap<
    string,
    { specPointId: string; code: string; title: string; weight?: number }[]
  >;
}): BacklogPoint[] {
  const out: BacklogPoint[] = [];
  const seen = new Set<string>();

  for (const band of params.bands) {
    if (!isTeachBand(band)) continue;

    // Date-keys are YYYY-MM-DD, so a lexical compare is a chronological one.
    const weeks: [
      string,
      { specPointId: string; code: string; title: string; weight?: number }[],
    ][] = band.pointsByWeek
      ? Object.entries(band.pointsByWeek)
      : [[band.startWeek, [...(params.pointsByTopic?.get(band.topicId) ?? [])]]];

    for (const [week, points] of weeks) {
      if (week >= params.weekStart) continue; // not passed yet
      for (const p of points) {
        if (seen.has(p.specPointId)) continue;
        if (isDelivered(p.specPointId, params.ledger)) continue;
        seen.add(p.specPointId);
        out.push({
          specPointId: p.specPointId,
          topicId: band.topicId,
          topicTitle: band.title,
          code: p.code,
          title: p.title,
          weight: weightOf(p),
          plannedWeek: week,
        });
      }
    }
  }

  // Oldest first: the longest-neglected work has the least runway left before
  // the exam, and a stable order keeps a re-cut from reshuffling the week.
  return out.sort(
    (a, b) => a.plannedWeek.localeCompare(b.plannedWeek) || a.code.localeCompare(b.code),
  );
}

/**
 * The share of a typical week's spine load that may be spent on catching up.
 *
 * A fifth. The constraint that matters is not fairness between old and new work
 * but that this week's teaching still has to happen: a student who missed a
 * month has a backlog several times the size of a week, and handing it to them
 * whole replaces the course with a debt collection. At a fifth a month's
 * backlog clears over about five weeks while the spine keeps running, which is
 * a recovery the student can actually see the end of.
 */
export const CATCH_UP_SHARE = 0.2;

/** How much backlog weight this week may absorb, given the spine's weekly load. */
export function catchUpBudget(weeklySpineWeight: number): number {
  return Math.max(0, weeklySpineWeight) * CATCH_UP_SHARE;
}

export interface Trickle {
  /** What this week takes on. */
  take: BacklogPoint[];
  /** What stays in the backlog for a later week. */
  held: BacklogPoint[];
}

/**
 * Take the oldest backlog work that fits inside `budget`, and hold the rest.
 *
 * Always takes at least one point when there is any budget at all. Without that
 * floor a spec point heavier than a fifth of a week — and on a real spec the
 * heaviest points are several times the lightest — would be skipped every week
 * forever while lighter points behind it were served, which is precisely the
 * silent permanent exclusion this module exists to end.
 *
 * Greedy in the backlog's own order rather than packed for the tightest fit:
 * "the thing you missed longest ago comes back first" is a rule a student can
 * predict, and a knapsack that reordered the queue to save a fraction of a
 * week's capacity would not be.
 */
export function trickle(backlog: BacklogPoint[], budget: number): Trickle {
  const take: BacklogPoint[] = [];
  const held: BacklogPoint[] = [];
  let spent = 0;
  for (const point of backlog) {
    // The floor: an empty week's take is never blocked by one oversized point.
    const fits = spent + point.weight <= budget || (take.length === 0 && budget > 0);
    if (fits && held.length === 0) {
      take.push(point);
      spent += point.weight;
    } else {
      // Once something is held, everything behind it is held too — otherwise a
      // light point jumps a heavy one and the oldest-first promise breaks.
      held.push(point);
    }
  }
  return { take, held };
}

/** Total weight of a set of backlog points — the size of the debt. */
export function backlogWeight(points: BacklogPoint[]): number {
  return points.reduce((sum, p) => sum + p.weight, 0);
}

/** Backlog grouped under its topic, oldest topic first, for reporting. */
export interface TopicBacklog {
  topicId: string;
  topicTitle: string;
  points: BacklogPoint[];
  weight: number;
  /** The earliest week any of its points was promised. */
  since: string;
}

export function byTopic(points: BacklogPoint[]): TopicBacklog[] {
  const groups = new Map<string, TopicBacklog>();
  for (const p of points) {
    const group = groups.get(p.topicId) ?? {
      topicId: p.topicId,
      topicTitle: p.topicTitle,
      points: [],
      weight: 0,
      since: p.plannedWeek,
    };
    group.points.push(p);
    group.weight += p.weight;
    if (p.plannedWeek < group.since) group.since = p.plannedWeek;
    groups.set(p.topicId, group);
  }
  return [...groups.values()].sort(
    (a, b) => a.since.localeCompare(b.since) || a.topicTitle.localeCompare(b.topicTitle),
  );
}
