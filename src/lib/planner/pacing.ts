import { mondayOf, addWeeks, toDateKey, weekKeyToDate } from "@/lib/week";

/**
 * Curriculum pacing — the year-long "programme" view. Given the course's topics
 * (in spec order) and a window from a start week to the exam, it lays each topic
 * into a band of weeks sized by how big the topic is, reserving a revision run
 * before the exam. As the student progresses, `computeLivePacing` re-flows the
 * topics they haven't covered yet from *this* week onward, so a slip pushes
 * everything after it back — and the difference against what they last
 * acknowledged is what the roadmap asks them to accept.
 *
 * Pure module: no I/O, so the allocation is unit-testable and deterministic.
 */

export interface PacingInput {
  topicId: string;
  title: string;
  /** How many spec points the topic has — its share of the timetable. */
  pointCount: number;
}

/**
 * What a band on the roadmap is for:
 *  • `teach`   — the chronological spine: first full pass through the topic.
 *  • `revisit` — an FSRS-driven focus week for a weak topic; recurs on an
 *                expanding interval until mastery clears the settled threshold.
 *  • `review`  — a light pre-exam pass for a topic that's already sticking.
 * Bands persisted before this field existed are spine bands (treat missing as
 * `teach`).
 */
export type BandKind = "teach" | "revisit" | "review";

/** One weak spec point riding inside a focus band (revisit), for display. */
export interface FocusPointRef {
  specPointId: string;
  code: string;
  title: string;
}

export interface PacingBand {
  topicId: string;
  title: string;
  /** Monday date-keys (inclusive) bounding the topic's run. */
  startWeek: string;
  endWeek: string;
  weeks: number;
  kind?: BandKind;
  /** For focus (revisit) bands: the specific weak spec points scheduled that
   *  week under this topic. Absent on teach/review bands. */
  points?: FocusPointRef[];
}

/** A spine band (legacy stored bands carry no kind). */
export function isTeachBand(b: PacingBand): boolean {
  return (b.kind ?? "teach") === "teach";
}

/** Whole weeks between two Mondays (b - a), rounded. */
export function weeksBetween(a: Date, b: Date): number {
  return Math.round((mondayOf(b).getTime() - mondayOf(a).getTime()) / (7 * 86_400_000));
}

/**
 * The exam anchor: the first Monday on/after 1 June of the exam year. UK summer
 * series sits in May–June, so if we're already past mid-June we point at next
 * year's series.
 */
export function examMondayFor(today: Date = new Date()): Date {
  const midJune = new Date(today.getFullYear(), 5, 15); // 15 Jun this year
  const year = today <= midJune ? today.getFullYear() : today.getFullYear() + 1;
  const june1 = new Date(year, 5, 1);
  return mondayOf(june1) < june1 ? addWeeks(mondayOf(june1), 1) : mondayOf(june1);
}

/**
 * Distribute `weeks` whole weeks across topics proportional to their size, every
 * topic getting at least one. Largest-remainder method so the totals add up.
 */
function allocateWeeks(topics: PacingInput[], weeks: number): number[] {
  const n = topics.length;
  if (n === 0) return [];
  const budget = Math.max(weeks, n); // at least one week each
  const total = topics.reduce((s, t) => s + Math.max(t.pointCount, 1), 0);
  const exact = topics.map((t) => (Math.max(t.pointCount, 1) / total) * budget);
  const base = exact.map((x) => Math.max(1, Math.floor(x)));
  let remaining = budget - base.reduce((s, x) => s + x, 0);
  // Hand out leftover weeks to the largest fractional parts.
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (remaining > 0 && order.length > 0) {
    base[order[k % order.length].i] += 1;
    remaining--;
    k++;
  }
  return base;
}

/** Lay topics into contiguous bands starting at `startMonday`. */
function bandsFrom(topics: PacingInput[], startMonday: Date, weeksEach: number[]): PacingBand[] {
  const bands: PacingBand[] = [];
  let cursor = mondayOf(startMonday);
  topics.forEach((t, idx) => {
    const w = Math.max(1, weeksEach[idx] ?? 1);
    const start = cursor;
    const end = addWeeks(cursor, w - 1);
    bands.push({
      topicId: t.topicId,
      title: t.title,
      startWeek: toDateKey(start),
      endWeek: toDateKey(end),
      weeks: w,
    });
    cursor = addWeeks(cursor, w);
  });
  return bands;
}

/**
 * The "ideal" plan: all topics laid from `startMonday` to the exam, reserving
 * `revisionWeeks` at the end. This is what gets stored when a programme is first
 * created.
 */
export function computePacing(
  topics: PacingInput[],
  startMonday: Date,
  examMonday: Date,
  revisionWeeks = 3,
): PacingBand[] {
  if (topics.length === 0) return [];
  const teaching = Math.max(topics.length, weeksBetween(startMonday, examMonday) - revisionWeeks);
  return bandsFrom(topics, startMonday, allocateWeeks(topics, teaching));
}

/**
 * The live plan given real progress: topics already covered keep their place;
 * everything still pending re-flows from `currentMonday` (or its ideal start, if
 * that's later) across the weeks left to the exam. So covering things on time
 * changes nothing, but a slip compresses/pushes what's left.
 */
export function computeLivePacing(params: {
  topics: PacingInput[];
  programStart: Date;
  examMonday: Date;
  currentMonday: Date;
  coveredTopicIds: Set<string>;
  revisionWeeks?: number;
}): PacingBand[] {
  const { topics, programStart, examMonday, currentMonday, coveredTopicIds } = params;
  const revisionWeeks = params.revisionWeeks ?? 3;
  if (topics.length === 0) return [];

  const ideal = computePacing(topics, programStart, examMonday, revisionWeeks);
  const idealByTopic = new Map(ideal.map((b) => [b.topicId, b]));

  // Covered topics are locked where they are; everything still pending re-flows.
  const settled: PacingBand[] = [];
  const pending: PacingInput[] = [];
  for (const t of topics) {
    if (coveredTopicIds.has(t.topicId)) settled.push(idealByTopic.get(t.topicId)!);
    else pending.push(t);
  }
  if (pending.length === 0) return ideal;

  // Re-flow pending from the later of "now" and their earliest ideal start.
  const earliestPendingStart = pending
    .map((t) => weekKeyToDate(idealByTopic.get(t.topicId)!.startWeek))
    .reduce((a, b) => (a < b ? a : b));
  const reflowStart =
    mondayOf(currentMonday) > earliestPendingStart ? mondayOf(currentMonday) : earliestPendingStart;

  const teaching = Math.max(pending.length, weeksBetween(reflowStart, examMonday) - revisionWeeks);
  const reflowed = bandsFrom(pending, reflowStart, allocateWeeks(pending, teaching));

  return [...settled, ...reflowed].sort((a, b) => a.startWeek.localeCompare(b.startWeek));
}

/** Below this mastery a topic is "needs work" — it gets recurring revisits. */
export const FOCUS_RED_BELOW = 34;

/** How many times a weak point resurfaces before the revision window, by band. */
function revisitCount(mastery: number): number {
  return mastery < FOCUS_RED_BELOW ? 3 : 1; // red keeps recurring; amber a single look
}

/** One weak spec point competing for a focus slot. */
export interface FocusCandidate {
  specPointId: string;
  topicId: string;
  topicTitle: string;
  code: string;
  pointTitle: string;
  /** 0–100 FSRS mastery — lower is weaker, and weaker wins the slot. */
  mastery: number;
}

/**
 * The focus lane as a **capacity-limited revision queue** rather than a flood.
 *
 * The problem it solves: FSRS resurfaces everything the instant it's rated, so a
 * student who rates nine topics badly would otherwise get nine revisits dumped
 * into next week. Instead we give each week a fixed budget of focus spec points
 * ({@link DEFAULT_FOCUS_BUDGET}) and spread the backlog across the weeks to the
 * exam, weakest-first.
 *
 * Week-by-week simulation: each weak point wants {@link revisitCount} revisits at
 * expanding intervals; every week we place the weakest available points up to the
 * budget and push the rest to the next week (cascade). A placed point's next
 * revisit is scheduled a widening gap later, so it competes again later — not
 * every week. Points that never fit before revision simply don't get scheduled
 * (an over-rated backlog can't all fit, and pretending otherwise is the bug).
 * Covered topics get one light review band in the pre-exam window, budget-exempt.
 *
 * Placed points are grouped by (week, topic) into revisit bands carrying their
 * specific spec points, so the roadmap shows "Topic 5 · 5.1, 5.4" — the real unit
 * of work — and never more than the budget in any week. Pure/deterministic, never
 * persisted: recomputed live from mastery every load.
 */
export const DEFAULT_FOCUS_BUDGET = 6;

export function scheduleFocusPoints(params: {
  candidates: FocusCandidate[];
  /** Settled topics — one review slot each, no revisits. */
  coveredTopics: { topicId: string; title: string }[];
  currentMonday: Date;
  examMonday: Date;
  /** Focus spec points allowed per week (excludes the pre-exam review pass). */
  weeklyBudget?: number;
  revisionWeeks?: number;
}): PacingBand[] {
  const { candidates, coveredTopics, examMonday } = params;
  const currentMonday = mondayOf(params.currentMonday);
  const budget = Math.max(1, params.weeklyBudget ?? DEFAULT_FOCUS_BUDGET);
  const revisionWeeks = params.revisionWeeks ?? 3;
  const revisionStart = addWeeks(mondayOf(examMonday), -revisionWeeks);
  const runway = Math.max(0, weeksBetween(currentMonday, revisionStart));

  const out: PacingBand[] = [];

  // A light review pass for settled topics, in the revision window (budget-exempt).
  if (revisionStart > currentMonday) {
    for (const t of coveredTopics) {
      out.push({
        topicId: t.topicId,
        title: t.title,
        startWeek: toDateKey(revisionStart),
        endWeek: toDateKey(revisionStart),
        weeks: 1,
        kind: "review",
      });
    }
  }

  if (runway <= 1 || candidates.length === 0) return out;

  // Widening gaps between a point's successive revisits, scaled to the runway.
  const gaps = [Math.max(2, Math.round(runway * 0.08)), Math.max(4, Math.round(runway * 0.2))];
  const gapAfter = (placed: number) => gaps[Math.min(placed, gaps.length - 1)];

  type Ticket = { c: FocusCandidate; remaining: number; placed: number; nextIdx: number };
  const tickets: Ticket[] = candidates.map((c) => ({
    c,
    remaining: revisitCount(c.mastery),
    placed: 0,
    nextIdx: 1, // everything wants next week; the budget is what spreads it
  }));

  const placedByWeek = new Map<number, FocusCandidate[]>();
  for (let wk = 1; wk < runway; wk++) {
    const avail = tickets
      .filter((t) => t.remaining > 0 && t.nextIdx <= wk)
      .sort((a, b) => a.c.mastery - b.c.mastery || a.nextIdx - b.nextIdx);
    let cap = budget;
    for (const t of avail) {
      if (cap <= 0) break;
      const list = placedByWeek.get(wk) ?? [];
      list.push(t.c);
      placedByWeek.set(wk, list);
      cap--;
      t.remaining--;
      t.nextIdx = wk + gapAfter(t.placed); // next look, a widening gap later
      t.placed++;
    }
    // Tickets that didn't fit keep nextIdx ≤ wk, so they're first in line next week.
  }

  // Group each week's placed points by topic into revisit bands.
  for (const [wk, cands] of placedByWeek) {
    const start = toDateKey(addWeeks(currentMonday, wk));
    const byTopic = new Map<string, FocusCandidate[]>();
    for (const c of cands) {
      const l = byTopic.get(c.topicId) ?? [];
      l.push(c);
      byTopic.set(c.topicId, l);
    }
    for (const [topicId, pts] of byTopic) {
      out.push({
        topicId,
        title: pts[0].topicTitle,
        startWeek: start,
        endWeek: start,
        weeks: 1,
        kind: "revisit",
        points: pts.map((p) => ({ specPointId: p.specPointId, code: p.code, title: p.pointTitle })),
      });
    }
  }

  return out.sort((a, b) => a.startWeek.localeCompare(b.startWeek));
}

/** Merge focus bands onto the teach spine in roadmap render order. */
export function mergeFocus(spine: PacingBand[], focus: PacingBand[]): PacingBand[] {
  return [...spine, ...focus].sort(
    (a, b) =>
      a.startWeek.localeCompare(b.startWeek) || Number(isTeachBand(b)) - Number(isTeachBand(a)),
  );
}

export interface PacingChange {
  topicId: string;
  title: string;
  from: string | null;
  to: string;
}

/**
 * Topics whose start week moved between the acknowledged plan and the live one.
 * Only spine (teach) bands count: the focus lane is recomputed live from
 * mastery, so its churn must never trigger an "accept the new plan" prompt.
 */
export function diffPacing(prev: PacingBand[], cur: PacingBand[]): PacingChange[] {
  const prevByTopic = new Map(prev.filter(isTeachBand).map((b) => [b.topicId, b]));
  const out: PacingChange[] = [];
  for (const b of cur.filter(isTeachBand)) {
    const p = prevByTopic.get(b.topicId);
    if (!p || p.startWeek !== b.startWeek) {
      out.push({ topicId: b.topicId, title: b.title, from: p?.startWeek ?? null, to: b.startWeek });
    }
  }
  return out;
}
