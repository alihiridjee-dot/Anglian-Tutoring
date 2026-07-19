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

export interface PacingBand {
  topicId: string;
  title: string;
  /** Monday date-keys (inclusive) bounding the topic's run. */
  startWeek: string;
  endWeek: string;
  weeks: number;
  kind?: BandKind;
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

/**
 * Expanding revisit offsets for a needs-work topic, scaled to the runway left
 * before the revision window: ~2.5%, 7.5%, 17.5% and 37.5% of the remaining
 * teaching weeks (each at least a week after the last). A full school year
 * (~44 wks) gives ≈ [1, 3, 8, 17]; a 12-week sprint compresses to [1, 2, 3, 5];
 * with only a couple of weeks left there's a single revisit next week. Same
 * spaced-repetition shape at every horizon — often at first, stretching out.
 */
export function revisitOffsets(runwayWeeks: number): number[] {
  const out: number[] = [];
  let prev = 0;
  for (const frac of [0.025, 0.075, 0.175, 0.375]) {
    const w = Math.max(prev + 1, Math.round(runwayWeeks * frac));
    if (w >= runwayWeeks) break;
    out.push(w);
    prev = w;
  }
  if (out.length === 0 && runwayWeeks > 1) out.push(1);
  return out;
}

/** An amber topic's single revisit lands ~10% of the runway after its teach
 *  pass (clamped to 2–6 weeks), so short courses re-check sooner. */
export function amberRevisitGap(runwayWeeks: number): number {
  return Math.min(6, Math.max(2, Math.round(runwayWeeks * 0.1)));
}

/**
 * The focus lane: overlay short FSRS-driven bands on the chronological spine.
 *
 *  • Needs-work topics (mastery < {@link FOCUS_RED_BELOW}) get 1-week revisit
 *    bands at expanding intervals starting next week — they keep resurfacing
 *    until mastery clears the settled threshold, at which point the topic reads
 *    as covered and the revisits disappear on the next re-flow.
 *  • Getting-there topics (below settled) get a single revisit ~a month after
 *    their teach pass ends (or soon, if that pass is already behind them).
 *  • Covered topics get one light review band in the pre-exam revision window.
 *
 * Revisits are derived live from mastery on every load — never persisted — so
 * the lane always reflects the cards as they stand today. Bands may overlap the
 * spine: a revisit week is homework/quiz focus alongside whatever topic is
 * being taught, which is exactly how the weekly plan interleaves due points.
 */
export function injectFocusBands(params: {
  spine: PacingBand[];
  /** Per-topic FSRS mastery (0–100), from getTopicProgress. */
  masteryByTopic: Map<string, number>;
  /** Topics already settled — get a review slot, never revisits. */
  coveredTopicIds: Set<string>;
  currentMonday: Date;
  examMonday: Date;
  settledThreshold: number;
  revisionWeeks?: number;
}): PacingBand[] {
  const { spine, masteryByTopic, coveredTopicIds, examMonday, settledThreshold } = params;
  const currentMonday = mondayOf(params.currentMonday);
  const revisionWeeks = params.revisionWeeks ?? 3;
  const revisionStart = addWeeks(mondayOf(examMonday), -revisionWeeks);
  // The runway drives all spacing: a year stretches revisits out, a short
  // sprint to the exam compresses the same pattern.
  const runway = Math.max(0, weeksBetween(currentMonday, revisionStart));
  const redOffsets = revisitOffsets(runway);
  const amberGap = amberRevisitGap(runway);

  const focus: PacingBand[] = [];
  const oneWeek = (t: PacingBand, start: Date, kind: BandKind): PacingBand => ({
    topicId: t.topicId,
    title: t.title,
    startWeek: toDateKey(start),
    endWeek: toDateKey(start),
    weeks: 1,
    kind,
  });
  const insideOwnTeach = (t: PacingBand, start: Date) => {
    const key = toDateKey(start);
    return t.startWeek <= key && key <= t.endWeek;
  };

  for (const t of spine) {
    if (coveredTopicIds.has(t.topicId)) {
      if (revisionStart > currentMonday) focus.push(oneWeek(t, revisionStart, "review"));
      continue;
    }
    const mastery = masteryByTopic.get(t.topicId) ?? 0;
    if (mastery < FOCUS_RED_BELOW) {
      for (const off of redOffsets) {
        const start = addWeeks(currentMonday, off);
        if (start >= revisionStart) break;
        if (!insideOwnTeach(t, start)) focus.push(oneWeek(t, start, "revisit"));
      }
    } else if (mastery < settledThreshold) {
      const teachEnd = weekKeyToDate(t.endWeek);
      const afterTeach = addWeeks(teachEnd, amberGap);
      const soon = addWeeks(currentMonday, 2);
      const start = afterTeach > soon ? afterTeach : soon;
      if (start < revisionStart && !insideOwnTeach(t, start)) {
        focus.push(oneWeek(t, start, "revisit"));
      }
    }
  }

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
