/**
 * Brute test 2 of 4: the spine. Week allocation, the weekly split, the UK
 * calendar, and the moves that change a spine (reorder, pause pick-up, breaks).
 * pacing.ts, topicOrder.ts, week.ts, breaks.ts, programDal.examDateBounds.
 */
import { describe, expect, test } from "bun:test";
import {
  computePacing,
  programStartFor,
  projectReviews,
  splitAcrossWeeks,
  weeksBetween,
  isTeachBand,
  type FocusCandidate,
  type PacingBand,
} from "../pacing";
import {
  orderInputs,
  reorderTopics,
  resumeAfterPause,
  stopIsCovered,
  type StopWeeks,
} from "../topicOrder";
import { addWeeks, mondayOf, toDateKey, weekKeyToDate } from "../week";
import {
  breakEndsOn,
  breakFits,
  breakWeekKeys,
  layBreaksOver,
  mondayKeyOf,
  overlapsBreak,
  reorderPreview,
  runWeeks,
  shiftKey,
  touchesExam,
  MAX_BREAK_WEEKS,
} from "../breaks";
import { projectCatchUp, type BacklogPoint } from "../backlog";
import { admit } from "../admissibility";
import { selectWeek } from "../weekCut";
import { examDateBounds } from "../programDal";
import type { RoadmapResult } from "../roadmap";
import {
  makeCourse,
  FULL,
  pacingInputs,
  promisedWeeks,
  rng,
  scaled,
  spineViolations,
  Tally,
  teachingWeeks,
  weeksOn,
  WEIGHTS,
  type Rng,
} from "./helpers";

const DAY = 86_400_000;
const START = "2026-09-07"; // a Monday
const LONG = 120_000;

describe("week allocation (computePacing)", () => {
  test(
    "P1 · 4,410 boundary courses: 0/1/2/5/14/50 topics × 0…208 weeks × exam on every weekday",
    () => {
      const tally = new Tally();
      let seed = 0;
      for (const n of [0, 1, 2, 5, 14, 50])
        for (const weeks of [0, 1, n - 1, n, n + 1, 2 * n + 3, 208])
          for (let weekday = 0; weekday < 7; weekday++)
            for (const kind of ["unit", "mixed", "tiny"] as const)
              for (let rep = 0; rep < scaled(5, 1); rep++) {
                if (weeks < 0) continue;
                const r = rng(seed++);
                const topics = makeCourse(r, { topics: n, unitWeights: kind === "unit" });
                if (kind === "tiny")
                  for (const t of topics)
                    for (const p of t.points) p.weight = r.pick([0.1, 0.2, 0.3]);
                const examDate = shiftKey(weeksOn(START, weeks), weekday);
                const problems: string[] = [];
                try {
                  const bands = computePacing(
                    pacingInputs(topics),
                    weekKeyToDate(START),
                    weekKeyToDate(examDate),
                  );
                  const starved = weeks < n;
                  const omitted = new Set(topics.slice(weeks).map((t) => t.topicId));
                  problems.push(
                    ...spineViolations(bands, topics, {
                      programStart: START,
                      examDate,
                      mayOmit: starved ? omitted : undefined,
                    }),
                  );
                  const total = bands.reduce((s, b) => s + b.weeks, 0);
                  if (n > 0 && !starved && total !== weeks)
                    problems.push(`${total} weeks laid over a ${weeks}-week runway`);
                  if (starved && bands.length !== weeks)
                    problems.push(`starved runway laid ${bands.length} topics in ${weeks} weeks`);
                  if (starved && bands.some((b, i) => b.topicId !== topics[i].topicId))
                    problems.push("starved runway kept the wrong topics");
                  if (bands.length && bands[0].startWeek !== START)
                    problems.push(`first band starts ${bands[0].startWeek}`);
                  for (let i = 1; i < bands.length; i++)
                    if (bands[i].startWeek !== weeksOn(bands[i - 1].endWeek, 1))
                      problems.push(`gap or overlap before band ${i}`);
                } catch (e) {
                  problems.push(`threw: ${(e as Error).message}`);
                }
                tally.check(
                  `${seed - 1} (n=${n}, weeks=${weeks}, exam weekday +${weekday}, ${kind})`,
                  problems,
                );
              }
      expect(tally.failed, tally.report("P1")).toBe(0);
      expect(tally.cases).toBeGreaterThan(FULL ? 4000 : 800);
    },
    LONG,
  );

  test(
    "P2 · 2,000 courses: a topic at least twice the size of another never gets fewer weeks (measured)",
    () => {
      let inversions = 0;
      let worst = "";
      for (let seed = 0; seed < scaled(2000); seed++) {
        const r = rng(60_000 + seed);
        const topics = makeCourse(r, { topics: r.int(2, 14) });
        const inputs = pacingInputs(topics);
        const weeks = r.int(inputs.length, inputs.length * 4);
        const bands = computePacing(
          inputs,
          weekKeyToDate(START),
          weekKeyToDate(weeksOn(START, weeks)),
        );
        for (const a of bands)
          for (const b of bands) {
            const wa = Math.max(1, inputs.find((t) => t.topicId === a.topicId)!.weight);
            const wb = Math.max(1, inputs.find((t) => t.topicId === b.topicId)!.weight);
            if (wa >= 2 * wb && a.weeks < b.weeks) {
              inversions++;
              worst ||= `seed ${60_000 + seed}: weight ${wa.toFixed(1)} got ${a.weeks} wk, weight ${wb.toFixed(1)} got ${b.weeks} wk`;
            }
          }
      }
      console.log(
        `[P2] size inversions in 2,000 courses: ${inversions}${worst ? ` — first: ${worst}` : ""}`,
      );
      expect(inversions).toBe(0);
    },
    LONG,
  );
});

describe("the weekly split of a topic (splitAcrossWeeks)", () => {
  /** Every way to cut n points into w runs, for small n: the true best heaviest week. */
  const bestHeaviest = (weights: number[], w: number): number => {
    const n = weights.length;
    let best = Infinity;
    const walk = (at: number, left: number, heaviest: number) => {
      if (left === 1) {
        const rest = weights.slice(at).reduce((s, x) => s + x, 0);
        best = Math.min(best, Math.max(heaviest, rest));
        return;
      }
      let run = 0;
      for (let end = at + 1; end <= n - (left - 1); end++) {
        run += weights[end - 1];
        walk(end, left - 1, Math.max(heaviest, run));
      }
    };
    walk(0, w, 0);
    return best;
  };

  test("P3 · 3,000 splits incl. 0.1/0.2/0.3 weights: nothing lost, order kept, no empty week, heaviest week is the true minimum", () => {
    const tally = new Tally();
    for (let seed = 0; seed < scaled(3000); seed++) {
      const r = rng(70_000 + seed);
      const n = r.int(0, 10);
      const points = Array.from({ length: n }, (_, i) => ({ id: i, w: r.pick(WEIGHTS) }));
      const weeks = r.pick([0, 1, 2, 3, 5, n, n + 2, 208]);
      const problems: string[] = [];
      try {
        const chunks = splitAcrossWeeks(points, weeks, (p) => p.w);
        const w = Math.max(1, Math.floor(weeks));
        if (chunks.length !== w) problems.push(`${chunks.length} chunks for ${w} weeks`);
        if (
          JSON.stringify(chunks.flat().map((p) => p.id)) !== JSON.stringify(points.map((p) => p.id))
        )
          problems.push("points lost, doubled or reordered");
        if (w <= n && chunks.some((c) => c.length === 0))
          problems.push("an empty week with points to spare");
        if (n > 0 && w > 1 && w < n) {
          const got = Math.max(...chunks.map((c) => c.reduce((s, p) => s + p.w, 0)));
          const want = bestHeaviest(
            points.map((p) => p.w),
            w,
          );
          if (got > want + 1e-9) problems.push(`heaviest week ${got} but ${want} was possible`);
        }
      } catch (e) {
        problems.push(`threw: ${(e as Error).message}`);
      }
      tally.check(70_000 + seed, problems);
    }
    expect(tally.failed, tally.report("P3")).toBe(0);
  });

  test("P3b · A5: 3,000 splits — the same weights ×1000 (whole numbers) give the same split", () => {
    const tally = new Tally();
    for (let seed = 0; seed < scaled(3000); seed++) {
      const r = rng(80_000 + seed);
      const n = r.int(3, 30);
      const points = Array.from({ length: n }, (_, i) => ({
        id: i,
        w: r.pick([0.1, 0.2, 0.3, 0.7, 1, 1.5]),
      }));
      const weeks = r.int(2, n - 1);
      const shape = (scale: number) =>
        splitAcrossWeeks(points, weeks, (p) => Math.round(p.w * scale * 1000) / 1000)
          .map((c) => c.length)
          .join(",");
      const float = shape(1);
      const whole = shape(1000);
      tally.check(
        80_000 + seed,
        float === whole
          ? []
          : [`decimal weights split ${float}; the same in whole numbers split ${whole}`],
      );
    }
    console.log(
      `[P3b] splits that differ between decimal and whole-number weights: ${tally.failed}/${tally.cases}`,
    );
    expect(tally.failed, tally.report("P3b")).toBe(0);
  });

  test("P3c · a 200-point topic over 52 weeks and a 500-point one over 208 finish in under 2 s each", () => {
    for (const [n, w] of [
      [200, 52],
      [500, 208],
    ] as const) {
      const points = Array.from({ length: n }, (_, i) => ({
        id: i,
        w: WEIGHTS[i % WEIGHTS.length],
      }));
      const t0 = performance.now();
      const chunks = splitAcrossWeeks(points, w, (p) => p.w);
      const ms = performance.now() - t0;
      console.log(`[P3c] ${n} points / ${w} weeks: ${ms.toFixed(0)} ms`);
      expect(chunks.flat()).toHaveLength(n);
      expect(ms).toBeLessThan(2000);
    }
  });
});

describe("the UK calendar (week.ts)", () => {
  test(
    "P4 · every day 2024–2031 at four times of day (11,688 instants): Monday maths holds across every clock change",
    () => {
      const tally = new Tally();
      // Two years still cross four clock changes and a 29 February.
      for (let day = Date.UTC(2024, 0, 1); day < Date.UTC(FULL ? 2032 : 2026, 0, 1); day += DAY)
        for (const offset of [0, 30 * 60_000, 90 * 60_000, 23.5 * 3_600_000]) {
          const d = new Date(day + offset);
          const problems: string[] = [];
          try {
            const key = toDateKey(d);
            const monday = mondayOf(d);
            const mKey = toDateKey(monday);
            if (new Date(`${mKey}T00:00:00Z`).getUTCDay() !== 1)
              problems.push(`mondayOf gave ${mKey}, not a Monday`);
            if (mKey > key) problems.push(`Monday ${mKey} is after the day ${key}`);
            if (shiftKey(mKey, 7) <= key)
              problems.push(`Monday ${mKey} is more than a week before ${key}`);
            if (toDateKey(mondayOf(monday)) !== mKey)
              problems.push("mondayOf is not stable on its own answer");
            if (toDateKey(weekKeyToDate(key)) !== key)
              problems.push(`key ${key} does not round-trip`);
            if (mKey !== mondayKeyOf(key))
              problems.push(
                `week.mondayOf (${mKey}) and breaks.mondayKeyOf (${mondayKeyOf(key)}) disagree`,
              );
            for (const n of [-60, -1, 1, 26, 208]) {
              const moved = addWeeks(monday, n);
              if (toDateKey(moved) !== shiftKey(mKey, 7 * n))
                problems.push(`addWeeks(${n}) landed on ${toDateKey(moved)}`);
              if (weeksBetween(monday, moved) !== n)
                problems.push(`weeksBetween says ${weeksBetween(monday, moved)}, not ${n}`);
            }
          } catch (e) {
            problems.push(`threw: ${(e as Error).message}`);
          }
          tally.check(d.toISOString(), problems);
        }
      expect(tally.failed, tally.report("P4")).toBe(0);
    },
    LONG,
  );

  test("P5 · programStartFor on every day of 2026–2027, one second either side of UK midnight: Sat/Sun start next Monday", () => {
    const tally = new Tally();
    for (let k = "2026-01-01"; k < "2028-01-01"; k = shiftKey(k, 1))
      for (const nudge of [1000, DAY - 1000]) {
        const at = new Date(weekKeyToDate(k).getTime() + nudge);
        const weekday = (new Date(`${toDateKey(at)}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
        const want =
          weekday >= 5 ? shiftKey(mondayKeyOf(toDateKey(at)), 7) : mondayKeyOf(toDateKey(at));
        const got = toDateKey(programStartFor(at));
        tally.check(at.toISOString(), got === want ? [] : [`started ${got}, expected ${want}`]);
      }
    expect(tally.failed, tally.report("P5")).toBe(0);
  });

  test("P6 · T4: examDateBounds on every day 2024–2104 gives a real calendar date as the latest exam", () => {
    const tally = new Tally();
    for (let k = "2024-01-01"; k < "2105-01-01"; k = shiftKey(k, 1)) {
      const { min, max } = examDateBounds(new Date(`${k}T12:00:00Z`));
      const problems: string[] = [];
      if (min !== k) problems.push(`min ${min}`);
      try {
        weekKeyToDate(max);
      } catch {
        problems.push(`latest exam date "${max}" is not a real date`);
      }
      tally.check(k, problems);
    }
    console.log(
      `[P6] days whose 4-year bound is not a real date: ${tally.failed} of ${tally.cases}${tally.samples.length ? ` (${tally.samples.join("; ")})` : ""}`,
    );
    expect(tally.failed, tally.report("P6")).toBe(0);
  });
});

describe("T3 · an exam date that is not a Monday", () => {
  const examMonday = "2027-06-07";
  const candidate = (id: string): FocusCandidate => ({
    specPointId: id,
    topicId: "t0",
    topicTitle: "T",
    code: "1.1",
    pointTitle: "P",
    dueAt: "2027-05-01T09:00:00Z",
    eligibleAt: "2027-05-01T09:00:00Z",
    lastReviewedAt: "2027-04-01T09:00:00Z",
    weight: 1,
  });
  const owed = (id: string): BacklogPoint => ({
    specPointId: id,
    topicId: "t0",
    topicTitle: "T",
    code: id,
    title: id,
    weight: 1,
    plannedWeek: "2027-01-04",
  });

  for (let weekday = 0; weekday < 7; weekday++) {
    const examDate = shiftKey(examMonday, weekday);
    const name = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][weekday];
    // Open by decision (T3, mid-week exam dates): only the Monday passes until Ali decides.
    (weekday === 0 ? test : test.failing)(
      `P7 · exam on a ${name} (${examDate}): nothing is scheduled into the exam week itself`,
      () => {
        const problems: string[] = [];
        // Reviews: 30 due, budget 1 a week, 2 weeks before the exam week.
        const reviews = projectReviews({
          candidates: Array.from({ length: 30 }, (_, i) => candidate(`r${i}`)),
          currentMonday: weekKeyToDate(weeksOn(examMonday, -2)),
          examMonday: weekKeyToDate(examDate),
          weeklyBudget: 1,
        });
        if (reviews.bands.some((b) => b.startWeek >= examMonday))
          problems.push("reviews were placed in the exam week");
        // Catch-up: 10 owed, 2 weeks before the exam week.
        const catchUp = projectCatchUp({
          backlog: Array.from({ length: 10 }, (_, i) => owed(`c${i}`)),
          assigned: [],
          weekStart: weeksOn(examMonday, -2),
          examDate,
          weeklyWeight: 5,
        });
        if (Object.keys(catchUp.weeks).some((w) => w >= examMonday))
          problems.push("catch-up was placed in the exam week");
        // The week cut and the admission rule, asked about the exam week.
        if (
          admit(
            { specPointId: "x", topicId: "t0", origin: "core" },
            { reach: new Map(), weekStart: examMonday, examDate },
          ).ok
        )
          problems.push("admit() allows an automatic point in the exam week");
        const roadmap = {
          examDate,
          backlog: [owed("c0")],
          catchUpSchedule: { weeks: { [examMonday]: [owed("c0")] }, assignedIds: [], held: [] },
          baselineBands: [],
          bands: [],
          progress: [],
          overrides: [],
          completedPointIds: [],
        } as unknown as RoadmapResult;
        if (selectWeek(roadmap, examMonday).specPointIds.length)
          problems.push("selectWeek cuts work into the exam week");
        expect(problems).toEqual([]);
      },
    );
  }
});

/** Legal breaks as the booking form allows them, after `today`. */
function bookBreaks(
  r: Rng,
  p: {
    bands: PacingBand[];
    topics: ReturnType<typeof makeCourse>;
    examDate: string;
    today: string;
    count: number;
  },
) {
  const breaks: { startsOn: string; endsOn: string }[] = [];
  for (let i = 0; i < p.count; i++) {
    const startsOn = weeksOn(p.today, r.int(0, 30));
    const weeks = r.int(1, MAX_BREAK_WEEKS);
    if (touchesExam({ startsOn, weeks, examDate: p.examDate })) continue;
    if (overlapsBreak(breaks, startsOn, weeks)) continue;
    if (runWeeks(breaks, startsOn, weeks) > MAX_BREAK_WEEKS) continue;
    if (
      !breakFits({
        bands: p.bands,
        topics: p.topics,
        breaks,
        examDate: p.examDate,
        startsOn,
        weeks,
      })
    )
      continue;
    breaks.push({ startsOn, endsOn: breakEndsOn(startsOn, weeks) });
  }
  return breaks;
}

describe("moves on a spine: nothing is ever lost or doubled", () => {
  const REFUSALS = [
    "Choose a week before your exams.",
    "There are no remaining topics to move from this week.",
    "There are not enough weeks before the exam",
    "The exams have started, so there is nothing to re-plan.",
  ];
  const refused = (e: unknown) => REFUSALS.some((m) => (e as Error).message.startsWith(m));

  test(
    "P8 · 3,000 courses × up to 7 random moves (reorder, pause pick-up, breaks laid): every point stays in exactly one week, the past never changes",
    () => {
      const tally = new Tally();
      let moves = 0;
      for (let seed = 0; seed < scaled(3000); seed++) {
        const r = rng(90_000 + seed);
        const topics = makeCourse(r);
        const runway = r.int(Math.max(1, topics.length - 2), topics.length * 4 + 6);
        const examDate = shiftKey(weeksOn(START, runway), r.bool(0.25) ? r.int(1, 6) : 0);
        const starved = runway < topics.length;
        const mayOmit = starved ? new Set(topics.slice(runway).map((t) => t.topicId)) : undefined;
        let bands = computePacing(
          pacingInputs(topics),
          weekKeyToDate(START),
          weekKeyToDate(examDate),
        );
        let today = START;
        const trail: string[] = [`runway ${runway} wk, ${topics.length} topics, exam ${examDate}`];
        const problems: string[] = [];
        for (let step = 0; step < r.int(1, 7) && problems.length === 0; step++) {
          today = weeksOn(today, r.int(0, 3));
          const before = bands;
          const pastOf = (b: PacingBand[], boundary: string) =>
            JSON.stringify(
              [...promisedWeeks(b, topics)]
                .map(([id, w]) => [id, w.filter((x) => x < boundary)])
                .filter(([, w]) => (w as string[]).length)
                .sort(),
            );
          const kind = r.pick(["reorder", "pause", "breaks"] as const);
          try {
            if (kind === "reorder") {
              const order = r.shuffle(
                orderInputs(bands, topics, today).remaining.map((t) => t.topicId),
              );
              trail.push(`reorder from ${today}`);
              bands = reorderTopics({ bands, topics, order, from: today, examDate, today });
              if (pastOf(bands, today) !== pastOf(before, today))
                problems.push(`reorder from ${today} changed an earlier week`);
            } else if (kind === "pause") {
              const pausedFrom = weeksOn(today, r.int(0, 2));
              const resumeFrom = weeksOn(pausedFrom, r.int(0, 5));
              trail.push(`pause ${pausedFrom}→${resumeFrom}`);
              bands = resumeAfterPause({ bands, topics, pausedFrom, resumeFrom, examDate });
              if (pastOf(bands, pausedFrom) !== pastOf(before, pausedFrom))
                problems.push(`pick-up changed a week before the pause`);
              if (bands !== before)
                for (const [week] of teachingWeeks(bands, topics))
                  if (week >= pausedFrom && week < resumeFrom)
                    problems.push(`teaching in paused week ${week}`);
              today = resumeFrom > today ? resumeFrom : today;
            } else {
              const breaks = bookBreaks(r, { bands, topics, examDate, today, count: r.int(1, 3) });
              if (!breaks.length) continue;
              trail.push(`breaks ${breaks.map((b) => `${b.startsOn}..${b.endsOn}`).join(", ")}`);
              const laid = layBreaksOver({ bands, topics, breaks, examDate });
              const again = layBreaksOver({ bands: laid, topics, breaks, examDate });
              if (JSON.stringify(again) !== JSON.stringify(laid))
                problems.push("laying the same breaks twice moved the plan again");
              const off = new Set(breakWeekKeys(breaks));
              for (const [week] of teachingWeeks(laid, topics))
                if (off.has(week)) problems.push(`teaching in break week ${week}`);
              const first = breaks.map((b) => b.startsOn).sort()[0];
              if (pastOf(laid, first) !== pastOf(before, first))
                problems.push("a break changed a week before it began");
              bands = laid;
              // The Monday after the first break ends (a break ends on a Sunday).
              today = shiftKey(breaks.map((b) => b.endsOn).sort()[0], 1);
            }
            moves++;
            problems.push(
              ...spineViolations(bands, topics, { programStart: START, examDate, mayOmit }),
            );
          } catch (e) {
            if (!refused(e)) problems.push(`${kind} threw: ${(e as Error).message}`);
            bands = before;
          }
        }
        tally.check(90_000 + seed, problems, () => trail.join(" → "));
      }
      console.log(`[P8] ${moves} moves applied across ${tally.cases} courses`);
      expect(tally.failed, tally.report("P8")).toBe(0);
    },
    LONG,
  );

  test(
    "P9 · 2,000 topic-order previews with a break booked: the calendar the student is shown is the one they get",
    () => {
      const tally = new Tally();
      let withBreak = 0;
      let inBreak = 0;
      for (let seed = 0; seed < scaled(2000); seed++) {
        const r = rng(100_000 + seed);
        const topics = makeCourse(r, { topics: r.int(3, 12) });
        const runway = r.int(topics.length + 8, topics.length * 3 + 14);
        const examDate = weeksOn(START, runway);
        const stored = computePacing(
          pacingInputs(topics),
          weekKeyToDate(START),
          weekKeyToDate(examDate),
        );
        const today = weeksOn(START, r.int(0, 3));
        const breaks = bookBreaks(r, { bands: stored, topics, examDate, today, count: 1 });
        if (!breaks.length) continue;
        withBreak++;
        // The list TopicOrderEditor offers: from the stored spine (storedBands).
        const order = r.shuffle(orderInputs(stored, topics, today).remaining.map((t) => t.topicId));
        const problems: string[] = [];
        try {
          // TopicOrderEditor's preview: the new order with the breaks ahead laid over it.
          const preview = reorderPreview({
            stored,
            topics,
            order,
            from: today,
            examDate,
            breaks,
            today,
          });
          // ProgramDAL.reorder (programDal.ts:528) — the save is cut from storedBands,
          // and the next load lays the break over it again.
          const saved = reorderTopics({
            bands: stored,
            topics,
            order,
            from: today,
            examDate,
            today,
          });
          const after = layBreaksOver({ bands: saved, topics, breaks, examDate });
          const off = new Set(breakWeekKeys(breaks));
          const previewTeachesInBreak = [...teachingWeeks(preview, topics).keys()].some((w) =>
            off.has(w),
          );
          if (previewTeachesInBreak) {
            inBreak++;
            problems.push("the preview puts teaching in the booked break");
          }
          const dates = (b: PacingBand[]) =>
            JSON.stringify(
              b
                .filter((x) => isTeachBand(x) && x.endWeek >= today)
                .map((x) => [x.topicId, x.startWeek, x.endWeek]),
            );
          if (dates(preview) !== dates(after))
            problems.push("topic dates after saving differ from the preview");
        } catch (e) {
          if (!refused(e)) problems.push(`threw: ${(e as Error).message}`);
        }
        tally.check(
          100_000 + seed,
          problems,
          () =>
            `break ${breaks[0].startsOn}..${breaks[0].endsOn}, reorder from ${today}, exam ${examDate}`,
        );
      }
      console.log(
        `[P9] previews with a break booked: ${withBreak}; preview shows teaching inside the break: ${inBreak}; preview ≠ what is saved: ${tally.failed}`,
      );
      expect(tally.failed, tally.report("P9")).toBe(0);
    },
    LONG,
  );

  test(
    "P10 · 2,000 pairs of stops that overlap (a pause and a break), picked up in start order as the planner does: no stopped week holds teaching",
    () => {
      const tally = new Tally();
      let nested = 0;
      let nestedBroken = 0;
      for (let seed = 0; seed < scaled(2000); seed++) {
        const r = rng(110_000 + seed);
        const topics = makeCourse(r, { topics: r.int(3, 10) });
        const runway = r.int(topics.length + 14, topics.length * 3 + 20);
        const examDate = weeksOn(START, runway);
        let bands = computePacing(
          pacingInputs(topics),
          weekKeyToDate(START),
          weekKeyToDate(examDate),
        );
        const a = weeksOn(START, r.int(1, 4));
        const first = { from: a, to: weeksOn(a, r.int(1, 6)) };
        const c = weeksOn(a, r.int(0, 5));
        const second = { from: c, to: weeksOn(c, r.int(1, 4)) };
        if (second.from >= first.to) continue; // only stops that overlap
        const isNested = second.to < first.to;
        if (isNested) nested++;
        // pickUpAfterPauses and resume_programme_after_pause both go by started_at,
        // and a stop inside one already handled moves nothing (stopIsCovered).
        const stops = [first, second].sort((x, y) => x.from.localeCompare(y.from));
        const problems: string[] = [];
        try {
          const handled: StopWeeks[] = [];
          for (const s of stops) {
            const stop = { pausedFrom: s.from, resumeFrom: s.to };
            if (!stopIsCovered(stop, handled))
              bands = resumeAfterPause({ bands, topics, ...stop, examDate });
            handled.push(stop);
          }
          for (const [week] of teachingWeeks(bands, topics))
            if (stops.some((s) => week >= s.from && week < s.to))
              problems.push(`teaching in stopped week ${week}`);
          problems.push(...spineViolations(bands, topics, { programStart: START, examDate }));
        } catch (e) {
          if (!refused(e)) problems.push(`threw: ${(e as Error).message}`);
        }
        if (problems.length && isNested) nestedBroken++;
        tally.check(
          110_000 + seed,
          problems,
          () => `stops ${stops.map((s) => `${s.from}→${s.to}`).join(" and ")}`,
        );
      }
      console.log(
        `[P10] overlapping pairs: ${tally.cases}; one stop inside the other: ${nested}, of which ${nestedBroken} left teaching in a stopped week; all broken: ${tally.failed}`,
      );
      expect(tally.failed, tally.report("P10")).toBe(0);
    },
    LONG,
  );
});
