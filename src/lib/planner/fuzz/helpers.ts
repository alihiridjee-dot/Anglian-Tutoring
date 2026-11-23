/**
 * Shared kit for the planner brute-test suite (22 Nov 2026 audit).
 *
 * Everything is seeded: a failing case prints its seed, and running the same
 * seed again gives the same course, dates and moves. Nothing here reads the
 * network or the clock.
 */
import {
  isTeachBand,
  withWeeklyPoints,
  weeksBetween,
  type FocusPointRef,
  type PacingBand,
} from "../pacing";
import type { OrderTopic } from "../topicOrder";
import { addWeeks, mondayOf, toDateKey, weekKeyToDate } from "../week";
import { mondayKeyOf } from "../breaks";

export interface Rng {
  next(): number;
  int(lo: number, hi: number): number;
  pick<T>(items: readonly T[]): T;
  bool(p?: number): boolean;
  shuffle<T>(items: readonly T[]): T[];
}

/** mulberry32: small, fast, and the same on every machine. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return {
    next,
    int,
    pick: (items) => items[Math.floor(next() * items.length)],
    bool: (p = 0.5) => next() < p,
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

/** Weights as a real spec has them, plus the decimals that upset float sums. */
export const WEIGHTS = [1, 1, 1, 1, 0.5, 2, 0.1, 0.2, 0.3, 0.7, 1.5, 3.7, 6, 0.05] as const;

export function makeCourse(
  r: Rng,
  opts: { topics?: number; maxPoints?: number; unitWeights?: boolean } = {},
): OrderTopic[] {
  const n = opts.topics ?? r.int(1, 14);
  const topics: OrderTopic[] = [];
  for (let t = 0; t < n; t++) {
    const count = r.int(1, opts.maxPoints ?? 9);
    const points: FocusPointRef[] = [];
    for (let p = 0; p < count; p++)
      points.push({
        specPointId: `t${t}p${p}`,
        code: `${t + 1}.${p + 1}`,
        title: `Point ${t + 1}.${p + 1}`,
        weight: opts.unitWeights ? 1 : r.pick(WEIGHTS),
      });
    topics.push({ topicId: `t${t}`, title: `Topic ${t + 1}`, points });
  }
  return topics;
}

export const topicWeight = (t: OrderTopic) =>
  t.points.reduce((s, p) => s + (Number.isFinite(p.weight) && p.weight! > 0 ? p.weight! : 1), 0);

export const pacingInputs = (topics: OrderTopic[]) =>
  topics.map((t) => ({ topicId: t.topicId, title: t.title, weight: topicWeight(t) || 1 }));

export const pointsByTopic = (topics: OrderTopic[]) =>
  new Map(topics.map((t) => [t.topicId, t.points]));

/** A Monday key `n` weeks after another. */
export const weeksOn = (key: string, n: number) => toDateKey(addWeeks(weekKeyToDate(key), n));

export const isMondayKey = (key: string) => {
  try {
    return toDateKey(mondayOf(weekKeyToDate(key))) === key;
  } catch {
    return false;
  }
};

/** Spec point → every week some teach band promises it in. */
export function promisedWeeks(bands: PacingBand[], topics: OrderTopic[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const band of withWeeklyPoints(bands.filter(isTeachBand), pointsByTopic(topics)))
    for (const [week, refs] of Object.entries(band.pointsByWeek ?? {}))
      for (const ref of refs) out.set(ref.specPointId, [...(out.get(ref.specPointId) ?? []), week]);
  return out;
}

/** Week → the topics teaching in it. */
export function teachingWeeks(bands: PacingBand[], topics: OrderTopic[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const band of withWeeklyPoints(bands.filter(isTeachBand), pointsByTopic(topics)))
    for (const [week, refs] of Object.entries(band.pointsByWeek ?? {}))
      if (refs.length) out.set(week, (out.get(week) ?? new Set()).add(band.topicId));
  return out;
}

/**
 * The rules every spine must keep, whatever was done to it. Returns what it
 * broke, in words; an empty list is a sound spine.
 *
 * `mayOmit` are topics the engine has said it cannot reach (a starved runway).
 */
export function spineViolations(
  bands: PacingBand[],
  topics: OrderTopic[],
  ctx: { programStart: string; examDate: string; mayOmit?: ReadonlySet<string> },
): string[] {
  const bad: string[] = [];
  const examMonday = mondayKeyOf(ctx.examDate);
  const teach = bands.filter(isTeachBand);
  for (const b of teach) {
    if (!isMondayKey(b.startWeek) || !isMondayKey(b.endWeek))
      bad.push(`band ${b.topicId} is not on Mondays (${b.startWeek}..${b.endWeek})`);
    else {
      if (b.endWeek < b.startWeek) bad.push(`band ${b.topicId} ends before it starts`);
      const span = weeksBetween(weekKeyToDate(b.startWeek), weekKeyToDate(b.endWeek)) + 1;
      if (span !== b.weeks) bad.push(`band ${b.topicId} says ${b.weeks} weeks but spans ${span}`);
    }
    if (b.endWeek >= examMonday)
      bad.push(`band ${b.topicId} runs into the exam week (${b.endWeek} >= ${examMonday})`);
    if (b.startWeek < ctx.programStart)
      bad.push(`band ${b.topicId} starts before the programme (${b.startWeek})`);
  }
  const promised = promisedWeeks(bands, topics);
  for (const t of topics)
    for (const p of t.points) {
      const weeks = promised.get(p.specPointId) ?? [];
      if (weeks.length === 0 && !ctx.mayOmit?.has(t.topicId))
        bad.push(`point ${p.specPointId} is in no week (lost)`);
      if (weeks.length > 1)
        bad.push(`point ${p.specPointId} is in ${weeks.length} weeks (${weeks})`);
      for (const w of weeks) {
        if (!isMondayKey(w)) bad.push(`point ${p.specPointId} sits on a non-Monday (${w})`);
        if (w >= examMonday)
          bad.push(`point ${p.specPointId} is promised in or after the exam week (${w})`);
      }
    }
  for (const [week, set] of teachingWeeks(bands, topics))
    if (set.size > 1) bad.push(`week ${week} teaches ${set.size} topics (${[...set]})`);
  return bad;
}

/** Collects failures across thousands of cases without drowning the report. */
export class Tally {
  cases = 0;
  failed = 0;
  samples: string[] = [];
  constructor(private keep = 4) {}
  check(seed: number | string, problems: string[], context?: () => string) {
    this.cases++;
    if (problems.length === 0) return;
    this.failed++;
    if (this.samples.length < this.keep)
      this.samples.push(
        `seed ${seed}: ${problems.slice(0, 3).join(" | ")}${problems.length > 3 ? ` (+${problems.length - 3} more)` : ""}${context ? `\n    ${context()}` : ""}`,
      );
  }
  report(name: string): string {
    return `${name}: ${this.failed}/${this.cases} cases broke the rule\n  ${this.samples.join("\n  ")}`;
  }
}

/** What the simulated student has done with one point. */
export interface PointState {
  reps?: number;
  dueAt?: string;
  eligibleAt?: string;
  lastReviewedAt?: string;
}

/**
 * The course as `ScheduleDAL.progressFrom` hands it to the roadmap, from a
 * plain map of what each point's memory card says. Only the fields the
 * planner's pure half reads are filled.
 */
export function makeProgress(
  topics: OrderTopic[],
  state: ReadonlyMap<string, PointState> = new Map(),
): import("../scheduleDal").TopicProgress[] {
  return topics.map((t) => ({
    topicId: t.topicId,
    title: t.title,
    masteryPct: 0,
    settled: false,
    practisedCount: 0,
    assessment: { state: "awaiting", masteryPct: null },
    points: t.points.map((p) => {
      const s = state.get(p.specPointId) ?? {};
      const reps = s.reps ?? 0;
      return {
        id: p.specPointId,
        code: p.code,
        title: p.title,
        confidence: null,
        homeworkScore: null,
        quizScore: reps ? 80 : null,
        status: reps ? "learning" : "new",
        mastery: reps ? 50 : 0,
        stability: reps ? 10 : null,
        weight: Number.isFinite(p.weight) && p.weight! > 0 ? p.weight! : 1,
        card: null,
        dueAt: s.dueAt ?? null,
        eligibleAt: s.eligibleAt ?? null,
        lastReviewedAt: s.lastReviewedAt ?? null,
        reps,
        retention: reps ? 0.9 : null,
        assessability: reps ? "assessed" : "awaiting",
      };
    }),
  })) as unknown as import("../scheduleDal").TopicProgress[];
}
