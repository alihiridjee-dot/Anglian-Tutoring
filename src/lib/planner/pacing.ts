import { mondayOf, addWeeks, toDateKey, weekKeyToDate } from "@/lib/week";

/**
 * Curriculum pacing — the year-long "programme" view. Given the course's topics
 * (in spec order) and a window from the student's start week to the exam, it
 * lays each topic into a band of weeks sized by its weight, using every
 * teaching week before the exam.
 *
 * The spine is FIXED: it runs sequentially from the week the student enrolled
 * to the agreed exam date and never re-flows. The whole course is always spread
 * evenly across that window, so an early starter gets lighter weeks and a late
 * joiner heavier ones — the runway sets the pace, nothing else. Progress,
 * confidence, marks — none of it moves a core band; the only thing that changes
 * week to week is the focus lane, which is computed separately
 * ({@link projectReviews}) and overlaid. The spine only ever changes when
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
 *  • `revisit` — an FSRS-driven focus week for a weak topic; contains the next
 *                eligible assessed review.
 *  • `review`  — a historical pre-exam band, retained for stored data compatibility.
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
  dueAt?: string;
  eligibleAt?: string;
}

/** A spec point's weight, defaulting to 1 for trees with none measured. */
export function weightOf(p: { weight?: number | null }): number {
  return Number.isFinite(p.weight) && p.weight! > 0 ? p.weight! : 1;
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
  const calendarYear = Number(toDateKey(today).slice(0, 4));
  const midJune = weekKeyToDate(`${calendarYear}-06-15`);
  const year = today <= midJune ? calendarYear : calendarYear + 1;
  const june1 = weekKeyToDate(`${year}-06-01`);
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

/** Allocate teaching across the full window before the exam. */
export function computePacing(
  topics: PacingInput[],
  startMonday: Date,
  examMonday: Date,
): PacingBand[] {
  if (topics.length === 0) return [];
  const teaching = Math.max(0, weeksBetween(startMonday, examMonday));
  // An impossible runway is reported by teachingWeeksShort; never invent weeks after the deadline.
  if (teaching < topics.length)
    return bandsFrom(topics.slice(0, teaching), startMonday, Array(teaching).fill(1));
  return bandsFrom(topics, startMonday, allocateWeeks(topics, teaching));
}

/** An assessed specification point with exactly one next review. */
export interface FocusCandidate {
  specPointId: string;
  topicId: string;
  topicTitle: string;
  code: string;
  pointTitle: string;
  dueAt: string;
  eligibleAt: string;
  lastReviewedAt: string;
  retention?: number | null;
  weight?: number;
}

export function focusDemand(candidates: FocusCandidate[]): number {
  return [...new Map(candidates.map((c) => [c.specPointId, c])).values()].reduce(
    (sum, c) => sum + weightOf(c),
    0,
  );
}

export interface FocusLoad {
  spine: number;
  overloaded: boolean;
  backlogCount?: number;
  backlogWeight?: number;
  teachingWeeksShort?: number;
}
export function focusLoadFor(params: {
  topics: PacingInput[];
  spine: PacingBand[];
  backlog?: FocusCandidate[];
  teachingWeeksShort?: number;
}): FocusLoad {
  const weeks = params.spine.filter(isTeachBand).reduce((s, b) => s + b.weeks, 0);
  const work = params.topics.reduce((s, t) => s + Math.max(t.weight, 1), 0);
  const spine = weeks > 0 ? work / weeks : 0;
  return {
    spine,
    overloaded: !!params.backlog?.length || (params.teachingWeeksShort ?? 0) > 0,
    backlogCount: params.backlog?.length ?? 0,
    backlogWeight: focusDemand(params.backlog ?? []),
    teachingWeeksShort: params.teachingWeeksShort ?? 0,
  };
}

export interface ReviewProjection {
  bands: PacingBand[];
  /** Due before the exam but unable to fit: retained for tutor action. */
  backlog: FocusCandidate[];
  /** Reviews beyond the exam remain in FSRS, without being pulled forward. */
  beyondExam: FocusCandidate[];
}

/** First weekly opening at or after the actual timestamp, never rounded backwards. */
export function mondayOnOrAfter(date: Date): Date {
  const monday = mondayOf(date);
  return monday < date ? addWeeks(monday, 1) : monday;
}

/**
 * Project only the next assessed review. Future performance is unknown, so there
 * are no invented repeat counts and no budget-exempt pre-exam sweep.
 */
export function projectReviews(params: {
  candidates: FocusCandidate[];
  /** A review cannot precede acknowledged teaching, even with early evidence. */
  topicOpenings?: ReadonlyMap<string, string>;
  currentMonday: Date;
  examMonday: Date;
}): ReviewProjection {
  const current = mondayOf(params.currentMonday);
  const horizon = params.examMonday;
  if (!Number.isFinite(current.getTime()) || !Number.isFinite(horizon.getTime()))
    throw new Error("Review projection requires valid start and exam dates.");
  const pending = [...new Map(params.candidates.map((c) => [c.specPointId, c])).values()]
    .filter((c) =>
      [c.dueAt, c.eligibleAt, c.lastReviewedAt].every((d) =>
        Number.isFinite(new Date(d).getTime()),
      ),
    )
    .map((c) => {
      const last = new Date(c.lastReviewedAt);
      // Absolute seven days protects the minimum across daylight-saving changes.
      const eligible = new Date(
        Math.max(
          new Date(c.dueAt).getTime(),
          new Date(c.eligibleAt).getTime(),
          last.getTime() + 7 * 86400000,
        ),
      );
      return { c, eligible, opening: mondayOnOrAfter(eligible) };
    });
  const beyondExam = pending.filter((t) => t.eligible >= horizon).map((t) => t.c);
  // With uncapped reviews, each point goes directly into its first eligible
  // week. Sort once, rather than scanning and splicing the queue for every week.
  const due = pending
    .filter((t) => t.eligible < horizon)
    .map((t) => ({
      ...t,
      week: new Date(
        Math.max(
          current.getTime(),
          t.opening.getTime(),
          params.topicOpenings?.get(t.c.topicId)
            ? weekKeyToDate(params.topicOpenings.get(t.c.topicId)!).getTime()
            : -Infinity,
        ),
      ),
      dueMs: new Date(t.c.dueAt).getTime(),
    }));
  const backlog = due.filter((t) => t.week >= horizon).map((t) => t.c);
  const scheduled = due
    .filter((t) => t.week < horizon)
    .sort(
      (a, b) =>
        a.week.getTime() - b.week.getTime() ||
        a.dueMs - b.dueMs ||
        (a.c.retention ?? 1) - (b.c.retention ?? 1) ||
        a.c.specPointId.localeCompare(b.c.specPointId),
    );
  const bands: PacingBand[] = [];
  const grouped = new Map<string, PacingBand>();
  for (const { c, week } of scheduled) {
    const key = toDateKey(week);
    const groupKey = `${key}|${c.topicId}`;
    let band = grouped.get(groupKey);
    if (!band) {
      band = {
        topicId: c.topicId,
        title: c.topicTitle,
        startWeek: key,
        endWeek: key,
        weeks: 1,
        kind: "revisit",
        points: [],
      };
      grouped.set(groupKey, band);
      bands.push(band);
    }
    band.points!.push({
      specPointId: c.specPointId,
      code: c.code,
      title: c.pointTitle,
      weight: c.weight,
      dueAt: c.dueAt,
      eligibleAt: c.eligibleAt,
    });
  }
  return { bands, backlog, beyondExam };
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

/**
 * The bands covering a given week — the programme's answer to "have you got
 * anything to say about this week?".
 *
 * Date-keys are YYYY-MM-DD, so a lexical compare is a chronological one.
 *
 * Callers must distinguish *no bands* from *bands with nothing left to do*: the
 * second is a real answer ("you're on top of this week"), and treating it as
 * silence is what used to hand the week to the fallback planner.
 */
export function bandsForWeek(bands: PacingBand[], weekStart: string): PacingBand[] {
  return bands.filter((b) => b.startWeek <= weekStart && b.endWeek >= weekStart);
}

/** A topic's points with their mastery — the shape {@link selectWeekPoints} reads. */
export interface WeekTopic {
  topicId: string;
  points: {
    id: string;
    mastery: number;
    weight?: number;
    stability?: number | null;
    reps?: number;
  }[];
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
  /**
   * Spec points taken from the backlog rather than from this week's own band —
   * work the spine promised in a week that has already passed ([[backlog]]).
   *
   * Reported separately but filed in the `core` lane, because that is what they
   * are: first teaching of a spec point, arriving late. A lane of their own
   * would need a new `plan_point_origin` value and would tell the student their
   * week is part remedial, when the honest framing is that the course is still
   * being covered — just not on the original date.
   */
  catchUpIds: string[];
  /** Titles of the topics this week's catch-up work came from, in order. */
  catchUpTopics: string[];
}

/** Combine all eligible reviews with the fixed weighted teaching allocation. */
export function selectWeekPoints(params: {
  bands: PacingBand[];
  /** Monday date-key of the week being planned. */
  weekStart: string;
  topics: WeekTopic[];
  /**
   * Backlog points this week is taking on, already limited to what it can hold
   * ({@link trickle}). The budget rule lives in [[backlog]]; this function only
   * places what it is given, after the two lanes that own the week proper.
   */
  catchUp?: { specPointId: string; topicTitle: string; weight?: number }[];
}): WeekSelection {
  const { weekStart, topics } = params;
  const inWeek = bandsForWeek(params.bands, weekStart);
  const byTopic = new Map(topics.map((t) => [t.topicId, t]));

  const specPointIds: string[] = [];
  const lanes: Record<string, WeekLane> = {};
  const seen = new Set<string>();
  /** Add each assigned point once, retaining its lane. */
  const addPoints = (items: { id: string; weight?: number }[], lane: WeekLane): number => {
    let n = 0;
    for (const p of items) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      specPointIds.push(p.id);
      lanes[p.id] = lane;
      n++;
    }
    return n;
  };

  // 1. The revisit lane — what the year plan earmarked for this week.
  const focusCount = addPoints(
    inWeek
      .filter((b) => b.kind === "revisit")
      .flatMap((b) => (b.points ?? []).map((p) => ({ id: p.specPointId, weight: p.weight }))),
    "focus",
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
    // Use the same fixed, weighted allocation as the roadmap.
    const chunks = splitAcrossWeeks(all, weeks, weightOf);
    // First learning follows this week's fixed curriculum allocation. Previously
    // assessed points wait for FSRS rather than becoming automatic refreshers.
    const took = addPoints(
      (chunks[idx] ?? []).filter((p) => !(p.reps && p.reps > 0)),
      "core",
    );
    teachCount += took;
    if (took > 0) teachTitle ??= band.title;
  }

  // 3. Catch-up — what the spine promised in a week that has already gone by.
  //    Last, and from a budget the caller has already capped, so a long backlog
  //    can never displace the teaching this week was actually for.
  const catchUpIds: string[] = [];
  const catchUpTopics: string[] = [];
  for (const point of params.catchUp ?? []) {
    if (seen.has(point.specPointId)) continue;
    seen.add(point.specPointId);
    specPointIds.push(point.specPointId);
    lanes[point.specPointId] = "core";
    catchUpIds.push(point.specPointId);
    if (!catchUpTopics.includes(point.topicTitle)) catchUpTopics.push(point.topicTitle);
  }

  return { specPointIds, lanes, teachTitle, focusCount, teachCount, catchUpIds, catchUpTopics };
}

/** Merge focus bands onto the teach spine in roadmap render order. */
export function mergeFocus(spine: PacingBand[], focus: PacingBand[]): PacingBand[] {
  return [...spine, ...focus].sort(
    (a, b) =>
      a.startWeek.localeCompare(b.startWeek) || Number(isTeachBand(b)) - Number(isTeachBand(a)),
  );
}

/**
 * What actually differs about a topic between the acknowledged plan and the
 * live one.
 *
 * This used to be implicit, and the display got it wrong. A change was recorded
 * whenever the start week, end week *or* length differed, but the only thing
 * rendered was "Moved from {from}" — so a topic that kept its start and merely
 * ran a week longer was labelled as having moved from the week it was already
 * sitting on. Naming the three cases makes that unrepresentable.
 */
export type PacingChangeKind =
  /** Not in the acknowledged plan at all. */
  | "added"
  /** Starts in a different week than before. */
  | "moved"
  /** Same start week, different length. */
  | "resized";

export interface PacingChange {
  topicId: string;
  title: string;
  from: string | null;
  to: string;
  kind: PacingChangeKind;
  /** Length before the change; null for a topic that is newly added. */
  fromWeeks: number | null;
  /** Length after it. */
  weeks: number;
}

/**
 * Topics whose spine band differs between the acknowledged plan and the live
 * one. Only spine (teach) bands count: the focus lane is recomputed live from
 * assessed memory, so its churn must never trigger an "accept the new plan" prompt.
 */
export function diffPacing(prev: PacingBand[], cur: PacingBand[]): PacingChange[] {
  const prevByTopic = new Map(prev.filter(isTeachBand).map((b) => [b.topicId, b]));
  const out: PacingChange[] = [];
  for (const b of cur.filter(isTeachBand)) {
    const p = prevByTopic.get(b.topicId);
    if (!p || p.startWeek !== b.startWeek || p.endWeek !== b.endWeek || p.weeks !== b.weeks) {
      out.push({
        topicId: b.topicId,
        title: b.title,
        from: p?.startWeek ?? null,
        to: b.startWeek,
        kind: !p ? "added" : p.startWeek !== b.startWeek ? "moved" : "resized",
        fromWeeks: p?.weeks ?? null,
        weeks: b.weeks,
      });
    }
  }
  return out;
}
