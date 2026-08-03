import { mondayOf, addWeeks, toDateKey, weekKeyToDate } from "@/lib/week";

/**
 * Curriculum pacing — the year-long "programme" view. Given the course's topics
 * (in spec order) and a window from the student's start week to the exam, it
 * lays each topic into a band of weeks sized by its weight, reserving a
 * revision run before the exam.
 *
 * The spine is FIXED: it runs sequentially from the week the student enrolled
 * to the agreed exam date and never re-flows. The whole course is always spread
 * evenly across that window, so an early starter gets lighter weeks and a late
 * joiner heavier ones — the runway sets the pace, nothing else. Progress,
 * confidence, marks — none of it moves a core band; the only thing that changes
 * week to week is the focus lane, which is computed separately
 * ({@link scheduleFocusPoints}) and overlaid. The spine only ever changes when
 * the exam date itself changes, and that shift is what the roadmap asks the
 * student to accept.
 *
 * Pure module: no I/O, so the allocation is unit-testable and deterministic.
 */

export interface PacingInput {
  topicId: string;
  title: string;
  /**
   * The topic's share of the timetable: the sum of its spec points' weights.
   *
   * This used to be a point *count*, which assumed every spec point was the same
   * size. On a real spec they differ by several times over — "know the word
   * equation for anaerobic respiration" against "investigate how enzyme activity
   * is affected by pH" — so counting handed short-but-numerous topics too many
   * weeks and dense ones too few. Falls back to the count when no weights are
   * measured, since `spec_points.weight` defaults to 1.
   */
  weight: number;
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
  /** Its share of a week's work; absent means "average", i.e. 1. */
  weight?: number;
}

/** A spec point's weight, defaulting to 1 for trees with none measured. */
export function weightOf(p: { weight?: number | null }): number {
  return p.weight && p.weight > 0 ? p.weight : 1;
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
  /**
   * For teach bands: the topic's spec points divided across the weeks of its
   * run, keyed by each week's Monday. A band used to say only "Topic 1, six
   * weeks" — the division into "these three this week" existed nowhere, so the
   * plan couldn't show it and the weekly view had to improvise its own. See
   * {@link withWeeklyPoints}.
   */
  pointsByWeek?: Record<string, FocusPointRef[]>;
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
  const total = topics.reduce((s, t) => s + Math.max(t.weight, 1), 0);
  const exact = topics.map((t) => (Math.max(t.weight, 1) / total) * budget);
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
  // The floor above is raised to 1 per topic, so a course whose weeks are
  // outnumbered by its topics can allocate more than the budget. Give the
  // overspend back from the roomiest topics rather than letting the spine run
  // past the exam.
  let over = base.reduce((s, x) => s + x, 0) - budget;
  while (over > 0) {
    const widest = base.indexOf(Math.max(...base));
    if (base[widest] <= 1) break; // every topic is down to its single week
    base[widest] -= 1;
    over--;
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
  /** Its share of a week's work; absent means "average", i.e. 1. */
  weight?: number;
}

/**
 * The focus lane as a **capacity-limited revision queue** rather than a flood.
 *
 * The problem it solves: FSRS resurfaces everything the instant it's rated, so a
 * student who rates nine topics badly would otherwise get nine revisits dumped
 * into next week. Instead we give each week a fixed budget of revision *work*
 * ({@link DEFAULT_FOCUS_BUDGET}) and spread the backlog across the weeks to the
 * exam, weakest-first.
 *
 * The budget is measured in weight, not in points, for the same reason the teach
 * spine is: six revisits is a different afternoon depending on which six. A week
 * holding one heavy practical and two definitions is full; six definitions is
 * also full. Counting slots made the first look two-thirds empty.
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
/**
 * A week's revision allowance, in weight.
 *
 * Held at 6 deliberately. On a tree with no measured weights every point counts
 * 1, so this is exactly the old "six points a week" and nothing changes. On a
 * weighted tree it buys two to four real points instead — fewer, but each an
 * honest piece of work, and roughly half the teach spine's ~11 units a week,
 * which is the right shape for revision sitting on top of new material.
 *
 * It is the dial for how hard the focus lane pushes: raising it to ~14 would
 * restore the old *volume* of revision (six average points), at the cost of
 * weeks that ran to nearly double the spine.
 */
export const DEFAULT_FOCUS_BUDGET = 6;

export function scheduleFocusPoints(params: {
  candidates: FocusCandidate[];
  /** Settled topics — one review slot each, no revisits. */
  coveredTopics: { topicId: string; title: string }[];
  currentMonday: Date;
  examMonday: Date;
  /** Revision work allowed per week, in weight (excludes the pre-exam review pass). */
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

  if (runway <= 0 || candidates.length === 0) return out;

  // Widening gaps between a point's successive revisits, scaled to the runway.
  const gaps = [Math.max(2, Math.round(runway * 0.08)), Math.max(4, Math.round(runway * 0.2))];
  const gapAfter = (placed: number) => gaps[Math.min(placed, gaps.length - 1)];

  type Ticket = { c: FocusCandidate; remaining: number; placed: number; nextIdx: number };
  const tickets: Ticket[] = candidates.map((c) => ({
    c,
    remaining: revisitCount(c.mastery),
    placed: 0,
    nextIdx: 0, // everything wants this week; the budget is what spreads it
  }));

  // From week 0 — the week the student is standing in. Starting at 1 meant a
  // topic they had just flagged as weak was always somebody else's problem: the
  // soonest the plan could act on it was the following Monday.
  const placedByWeek = new Map<number, FocusCandidate[]>();
  for (let wk = 0; wk < runway; wk++) {
    const avail = tickets
      .filter((t) => t.remaining > 0 && t.nextIdx <= wk)
      .sort((a, b) => a.c.mastery - b.c.mastery || a.nextIdx - b.nextIdx);
    let cap = budget;
    for (const t of avail) {
      if (cap <= 0) break;
      const list = placedByWeek.get(wk) ?? [];
      list.push(t.c);
      placedByWeek.set(wk, list);
      // A point that overshoots the remaining budget still goes in — it is the
      // weakest thing left and the week is then full. Charging its full weight
      // is what stops a second heavy point joining it.
      cap -= weightOf(t.c);
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
        points: pts.map((p) => ({
          specPointId: p.specPointId,
          code: p.code,
          title: p.pointTitle,
          weight: p.weight,
        })),
      });
    }
  }

  return out.sort((a, b) => a.startWeek.localeCompare(b.startWeek));
}

/**
 * Divide a topic's spec points across the weeks of its run so every week is the
 * same amount of *work* — the one rule for "how much of this topic is a week's
 * worth".
 *
 * It used to cut equal counts, rounded up: thirteen points over five weeks went
 * 3/3/3/3/1, so the last week of every topic was a stub, and with enough weeks
 * (`ceil` overshooting) trailing weeks came out empty — a week of the plan with
 * nothing on the spine at all. Counting also ignored that points differ in size,
 * which is the bigger error: the heaviest point on a real spec is several times
 * the lightest, so an equal-count week was anywhere between half an hour and
 * three hours.
 *
 * Deliberately still a flat, static chunking of the topic's whole point list:
 * week 3's share is week 3's share whether or not weeks 1 and 2 got done, so the
 * plan a student looks at in October says the same thing it said in July.
 * Catching up on what was missed is the weekly view's job
 * ({@link selectWeekPoints}), not the calendar's.
 */
export function splitAcrossWeeks<T>(
  points: T[],
  weeks: number,
  weight: (p: T) => number = () => 1,
): T[][] {
  const w = Math.max(1, Math.floor(weeks));
  if (points.length === 0) return Array.from({ length: w }, () => []);
  // More weeks than points: one each, then nothing left to give.
  if (w >= points.length)
    return Array.from({ length: w }, (_, i) => (i < points.length ? [points[i]] : []));

  // Exact minimum-maximum partition. `best[i][j]` is the lightest possible
  // heaviest week when the first i points are dealt into j weeks; `cut` records
  // where the last week started so the split can be walked back out. Points stay
  // in spec order — a week is always a contiguous run — so this only chooses
  // where the boundaries fall, never what goes where.
  const n = points.length;
  const w0 = points.map(weight);
  const prefix = [0];
  for (let i = 0; i < n; i++) prefix.push(prefix[i] + Math.max(0, w0[i]));

  // Two objectives, in order: make the heaviest week as light as possible, then
  // make the lightest week as heavy as possible. The second matters — minimising
  // the maximum alone leaves many equally-good splits, and the arbitrary one is
  // usually the split that dumps the remainder into a single stub week. On the
  // real AQA tree that difference was a lightest week of 4.0 against 6.6 for the
  // same optimal heaviest week of 12.2.
  const heaviest: number[][] = Array.from({ length: n + 1 }, () => new Array(w + 1).fill(Infinity));
  const lightest: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(w + 1).fill(-Infinity),
  );
  const cut: number[][] = Array.from({ length: n + 1 }, () => new Array(w + 1).fill(0));
  for (let j = 0; j <= w; j++) {
    heaviest[0][j] = 0;
    lightest[0][j] = Infinity; // no weeks yet — nothing constrains the minimum
  }
  for (let i = 1; i <= n; i++) {
    heaviest[i][1] = prefix[i];
    lightest[i][1] = prefix[i];
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 2; j <= w; j++) {
      for (let x = 1; x < i; x++) {
        const chunk = prefix[i] - prefix[x];
        const mx = Math.max(heaviest[x][j - 1], chunk);
        const mn = Math.min(lightest[x][j - 1], chunk);
        // Better = lighter heaviest week; on a tie, heavier lightest week; on a
        // full tie, the later cut, so any short week falls at the end of the run
        // rather than opening it.
        const better =
          mx < heaviest[i][j] ||
          (mx === heaviest[i][j] && (mn > lightest[i][j] || mn === lightest[i][j]));
        if (better) {
          heaviest[i][j] = mx;
          lightest[i][j] = mn;
          cut[i][j] = x;
        }
      }
    }
  }

  const sizes: number[] = [];
  let i = n;
  for (let j = w; j > 1; j--) {
    const x = cut[i][j];
    sizes.unshift(i - x);
    i = x;
  }
  sizes.unshift(i);

  const out: T[][] = [];
  let at = 0;
  for (const size of sizes) {
    out.push(points.slice(at, at + size));
    at += size;
  }
  return out;
}

/**
 * Hand every teach band its topic's spec points, split across the weeks it
 * spans. Recomputed on load rather than stored: it must follow the topic's real
 * point list, and keeping it out of the acknowledged baseline means re-dividing
 * never reads as "your plan has shifted".
 */
export function withWeeklyPoints(
  bands: PacingBand[],
  pointsByTopic: Map<string, FocusPointRef[]>,
): PacingBand[] {
  return bands.map((b) => {
    if (!isTeachBand(b)) return b;
    const points = pointsByTopic.get(b.topicId) ?? [];
    if (points.length === 0) return b;
    const chunks = splitAcrossWeeks(points, b.weeks, weightOf);
    const start = weekKeyToDate(b.startWeek);
    const pointsByWeek: Record<string, FocusPointRef[]> = {};
    chunks.forEach((chunk, i) => {
      if (chunk.length > 0) pointsByWeek[toDateKey(addWeeks(start, i))] = chunk;
    });
    return { ...b, pointsByWeek };
  });
}

/** A topic's points with their mastery — the shape {@link selectWeekPoints} reads. */
export interface WeekTopic {
  topicId: string;
  points: { id: string; mastery: number; weight?: number }[];
}

/** Which lane of the programme a week's point came from. */
export type WeekLane = "core" | "focus";

export interface WeekSelection {
  specPointIds: string[];
  /** Spec-point id → the lane it came from, so the plan can show the split. */
  lanes: Record<string, WeekLane>;
  /** Title of the topic on the teach spine this week, if any. */
  teachTitle: string | null;
  focusCount: number;
  teachCount: number;
  reviewCount: number;
}

/**
 * What one week of the programme contains — the bridge from the year plan to the
 * weekly plan, so the two can never disagree about a student.
 *
 * **Two lanes, two budgets.** Both have to happen: the course must be taught,
 * spread evenly over the year, *and* the points the student is weak on must come
 * back round. So `focusBudget` caps the revisit lane only, and the spine's share
 * of the week is added on top of it rather than competing for the same slots. A
 * single shared cap looked tidy and was wrong — a student carrying six flagged
 * points got six revisits and no new material, every week, for as long as the
 * backlog lasted.
 *
 * The spine's share is set by the year plan, not here: a band spanning six weeks
 * hands out a sixth of its topic each week, which is what "spread across the
 * year" means in practice.
 */
export function selectWeekPoints(params: {
  bands: PacingBand[];
  /** Monday date-key of the week being planned. */
  weekStart: string;
  topics: WeekTopic[];
  /** Cap on the revisit lane — and on the pre-exam review pass. Never on teaching. */
  focusBudget: number;
  /** Below this a point still wants work; at or above it, it's settled. */
  settledThreshold: number;
}): WeekSelection {
  const { weekStart, topics, settledThreshold } = params;
  const focusBudget = Math.max(0, params.focusBudget);
  // Date-keys are YYYY-MM-DD, so a lexical compare is a chronological one.
  const inWeek = params.bands.filter((b) => b.startWeek <= weekStart && b.endWeek >= weekStart);
  const byTopic = new Map(topics.map((t) => [t.topicId, t]));

  const specPointIds: string[] = [];
  const lanes: Record<string, WeekLane> = {};
  const seen = new Set<string>();
  /**
   * Append points in one lane until `budget` units of work are used up, and
   * return how many landed. The point that crosses the line is included — a
   * budget is a target, and stopping short of it would leave the week light.
   */
  const addWeighted = (
    items: { id: string; weight?: number }[],
    lane: WeekLane,
    budget: number,
  ): number => {
    let used = 0;
    let n = 0;
    for (const p of items) {
      if (used >= budget || seen.has(p.id)) continue;
      seen.add(p.id);
      specPointIds.push(p.id);
      lanes[p.id] = lane;
      used += weightOf(p);
      n++;
    }
    return n;
  };

  // 1. The revisit lane — what the year plan earmarked for this week, capped.
  const focusCount = addWeighted(
    inWeek
      .filter((b) => b.kind === "revisit")
      .flatMap((b) => (b.points ?? []).map((p) => ({ id: p.specPointId, weight: p.weight }))),
    "focus",
    focusBudget,
  );

  // 2. The teach spine — this week's share of the topic being taught, uncapped.
  let teachTitle: string | null = null;
  let teachCount = 0;
  for (const band of inWeek.filter(isTeachBand)) {
    const all = byTopic.get(band.topicId)?.points ?? [];
    if (all.length === 0) continue;
    const weeks = Math.max(1, band.weeks);
    const idx = Math.min(
      Math.max(0, weeksBetween(weekKeyToDate(band.startWeek), weekKeyToDate(weekStart))),
      weeks - 1,
    );
    // The same division the plan shows ({@link splitAcrossWeeks}), so the week
    // and the roadmap can't disagree about what a week's worth is. Take
    // everything owed up to and including this week that still isn't settled:
    // stragglers therefore come first and nothing is ever stepped over, while
    // the week keeps its size.
    //
    // "Its size" is THIS week's share, measured in work. It used to be
    // `chunks[0].length` — the first chunk's point count — which was the largest
    // chunk under the old round-up split, so in the final week of every topic
    // the roadmap promised one point and the week handed over three. Budgeting
    // by weight also means a week of one heavy point is a full week, rather than
    // three heavy ones because three was the number.
    const chunks = splitAcrossWeeks(all, weeks, weightOf);
    const budget =
      chunks[idx]?.reduce((s, p) => s + weightOf(p), 0) || weightOf(chunks[0]?.[0] ?? {});
    const owed = chunks.slice(0, idx + 1).flat();
    const took = addWeighted(
      owed.filter((p) => p.mastery < settledThreshold),
      "core",
      budget,
    );
    if (took > 0) teachTitle ??= band.title;
    teachCount += took;
  }

  // 3. Revision weeks: a light pass over what's settled, weakest first. Core
  // curriculum coming back round before the exam, so it reads as core.
  const reviewCount = addWeighted(
    inWeek
      .filter((b) => b.kind === "review")
      .flatMap((b) => byTopic.get(b.topicId)?.points ?? [])
      .sort((a, b) => a.mastery - b.mastery),
    "core",
    focusBudget,
  );

  return { specPointIds, lanes, teachTitle, focusCount, teachCount, reviewCount };
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
