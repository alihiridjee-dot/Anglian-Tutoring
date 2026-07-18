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

export interface PacingBand {
  topicId: string;
  title: string;
  /** Monday date-keys (inclusive) bounding the topic's run. */
  startWeek: string;
  endWeek: string;
  weeks: number;
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

/** A stable fingerprint of a pacing (topic → its start week). */
export function signatureOf(bands: PacingBand[]): string {
  return bands
    .map((b) => `${b.topicId}:${b.startWeek}`)
    .sort()
    .join("|");
}

export interface PacingChange {
  topicId: string;
  title: string;
  from: string | null;
  to: string;
}

/** Topics whose start week moved between the acknowledged plan and the live one. */
export function diffPacing(prev: PacingBand[], cur: PacingBand[]): PacingChange[] {
  const prevByTopic = new Map(prev.map((b) => [b.topicId, b]));
  const out: PacingChange[] = [];
  for (const b of cur) {
    const p = prevByTopic.get(b.topicId);
    if (!p || p.startWeek !== b.startWeek) {
      out.push({ topicId: b.topicId, title: b.title, from: p?.startWeek ?? null, to: b.startWeek });
    }
  }
  return out;
}
