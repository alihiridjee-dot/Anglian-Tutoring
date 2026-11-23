/**
 * Brute test 3 of 4: what a week may hold. The review budget, catch-up, the
 * 200-point cap, admission, tutor overrides and the re-cut merge.
 * pacing.projectReviews, backlog.ts, admissibility.ts, overrides.ts, weekCut.ts.
 */
import { describe, expect, test } from "bun:test";
import {
  mondayOnOrAfter,
  projectReviews,
  reviewBudget,
  REVIEW_SHARE,
  type FocusCandidate,
} from "../pacing";
import { catchUpBudget, projectCatchUp, trickle, type BacklogPoint } from "../backlog";
import { admit, type PointOrigin } from "../admissibility";
import { applyOverrides, indexOverrides, type PlanOverride } from "../overrides";
import { MAX_WEEK_POINTS, mergeWeek, weekIsForAnotherCourse, type WeekSelection } from "../weekCut";
import type { PlanPoint, PlanPointOrigin } from "../weeklyPlanDal";
import type { PointCoverage } from "../coverage";
import { toDateKey, weekKeyToDate } from "../week";
import { rng, Tally, weeksOn, WEIGHTS, type Rng } from "./helpers";

const DAY = 86_400_000;
const NOW = "2026-11-23"; // a Monday
const LONG = 120_000;

describe("reviews against the weekly budget (REVIEW_SHARE = 3)", () => {
  function reviewCase(r: Rng, count: number) {
    const current = weekKeyToDate(NOW);
    const weeksLeft = r.pick([0, 1, 2, 6, 20, 40]);
    const examMonday = weekKeyToDate(weeksOn(NOW, weeksLeft));
    const spine = r.pick([0, 0.4, 3, 12, 40]);
    const budget = reviewBudget(spine);
    const candidates: FocusCandidate[] = Array.from({ length: count }, (_, i) => {
      // Mostly overdue (a student back after months away), some still to come.
      const due = current.getTime() + r.int(-150, r.bool(0.2) ? 200 : 0) * DAY + r.int(0, DAY);
      const last = due - r.int(1, 60) * DAY;
      return {
        specPointId: `p${i}`,
        topicId: `t${i % 6}`,
        topicTitle: `Topic ${i % 6}`,
        code: `${i}`,
        pointTitle: `Point ${i}`,
        dueAt: new Date(due).toISOString(),
        eligibleAt: new Date(Math.max(due, last + 7 * DAY)).toISOString(),
        lastReviewedAt: new Date(last).toISOString(),
        retention: r.next(),
        // Includes single reviews heavier than the whole budget.
        weight: r.bool(0.05) ? budget + r.int(1, 30) : r.pick(WEIGHTS),
      };
    });
    const openings = new Map<string, string>();
    for (let t = 0; t < 6; t++)
      if (r.bool(0.4)) openings.set(`t${t}`, weeksOn(NOW, r.int(-10, 12)));
    const closed = new Set<string>();
    // A break of 1–4 weeks closes every point; a tutor closes single points.
    const breakFrom = r.bool(0.4) ? r.int(0, 8) : -1;
    const breakLen = r.int(1, 4);
    const offWeeks = new Set(
      breakFrom >= 0 ? Array.from({ length: breakLen }, (_, i) => weeksOn(NOW, breakFrom + i)) : [],
    );
    for (let i = 0; i < count; i++)
      if (r.bool(0.06)) closed.add(`p${i}|${weeksOn(NOW, r.int(0, 6))}`);
    const isBlocked = (id: string, week: string) =>
      offWeeks.has(week) || closed.has(`${id}|${week}`);
    return { current, examMonday, budget, candidates, openings, isBlocked, weeksLeft };
  }

  test(
    "B1 · 2,500 queues of 0–400 reviews (incl. 250 overdue at once, oversized single reviews, breaks, tutor removals)",
    () => {
      const tally = new Tally();
      let peak = 0;
      for (let seed = 0; seed < 2500; seed++) {
        const r = rng(200_000 + seed);
        const c = reviewCase(r, r.pick([0, 1, 30, 250, 250, 400]));
        const problems: string[] = [];
        try {
          const out = projectReviews({
            candidates: c.candidates,
            topicOpenings: c.openings,
            currentMonday: c.current,
            examMonday: c.examMonday,
            isBlocked: c.isBlocked,
            weeklyBudget: c.budget,
            readyBy: c.current,
          });
          const byId = new Map(c.candidates.map((x) => [x.specPointId, x]));
          const placed = new Map<string, string>();
          const load = new Map<string, { weight: number; count: number }>();
          for (const band of out.bands)
            for (const p of band.points ?? []) {
              if (placed.has(p.specPointId)) problems.push(`${p.specPointId} placed twice`);
              placed.set(p.specPointId, band.startWeek);
              const l = load.get(band.startWeek) ?? { weight: 0, count: 0 };
              l.weight += byId.get(p.specPointId)!.weight ?? 1;
              l.count++;
              load.set(band.startWeek, l);
            }
          const seen = new Set<string>([...placed.keys()]);
          for (const x of [...out.backlog, ...out.beyondExam]) {
            if (seen.has(x.specPointId)) problems.push(`${x.specPointId} is in two outcomes`);
            seen.add(x.specPointId);
          }
          if (seen.size !== c.candidates.length)
            problems.push(`${c.candidates.length - seen.size} reviews vanished`);
          const examKey = toDateKey(c.examMonday);
          for (const [week, l] of load) {
            peak = Math.max(peak, l.count);
            if (l.weight > c.budget + 1e-9 && l.count > 1)
              problems.push(
                `week ${week} holds ${l.weight.toFixed(2)} against a budget of ${c.budget}`,
              );
            if (week >= examKey) problems.push(`review placed in/after the exam week ${week}`);
            if (week < NOW) problems.push(`review placed in a past week ${week}`);
          }
          for (const [id, week] of placed) {
            const x = byId.get(id)!;
            const earliest = toDateKey(
              mondayOnOrAfter(
                new Date(
                  Math.max(
                    new Date(x.dueAt).getTime(),
                    new Date(x.eligibleAt).getTime(),
                    new Date(x.lastReviewedAt).getTime() + 7 * DAY,
                  ),
                ),
              ),
            );
            if (week < earliest)
              problems.push(`${id} reviewed in ${week}, before it is eligible (${earliest})`);
            const opens = c.openings.get(x.topicId);
            if (opens && week < opens) problems.push(`${id} reviewed before its topic opens`);
            if (c.isBlocked(id, week)) problems.push(`${id} placed in a week closed to it`);
          }
          // Nothing waits while an open week still has room for it.
          for (const x of out.backlog) {
            const w = x.weight ?? 1;
            for (const [week, l] of load)
              // Room means real room: a sliver lost to float sums (8.95 + 0.05 > 9) is noted in the report, not failed here.
              if (
                !c.isBlocked(x.specPointId, week) &&
                l.weight + w <= c.budget - 1e-6 &&
                week >= (c.openings.get(x.topicId) ?? "") &&
                week >=
                  toDateKey(
                    mondayOnOrAfter(
                      new Date(
                        Math.max(
                          new Date(x.dueAt).getTime(),
                          new Date(x.eligibleAt).getTime(),
                          new Date(x.lastReviewedAt).getTime() + 7 * DAY,
                        ),
                      ),
                    ),
                  )
              )
                problems.push(
                  `${x.specPointId} (weight ${w}) left over although week ${week} had room (${l.weight.toFixed(2)} of ${c.budget}, ${l.count} reviews; ${c.weeksLeft} weeks to the exam)`,
                );
          }
          for (const x of out.waiting)
            if (!placed.has(x.specPointId) || placed.get(x.specPointId)! <= NOW)
              problems.push(`${x.specPointId} "waiting" but not placed later`);
        } catch (e) {
          problems.push(`threw: ${(e as Error).message}`);
        }
        tally.check(200_000 + seed, problems);
      }
      console.log(
        `[B1] most reviews the budget ever put in one week: ${peak} (the week cap is ${MAX_WEEK_POINTS})`,
      );
      expect(tally.failed, tally.report("B1")).toBe(0);
    },
    LONG,
  );

  test("B1b · 250 overdue unit-weight reviews, spine 5 a week (budget 15): 15 a week, none lost, oldest first", () => {
    const r = rng(1);
    const candidates: FocusCandidate[] = Array.from({ length: 250 }, (_, i) => {
      const due = weekKeyToDate(NOW).getTime() - (250 - i) * DAY;
      return {
        specPointId: `p${String(i).padStart(3, "0")}`,
        topicId: "t",
        topicTitle: "T",
        code: `${i}`,
        pointTitle: "P",
        dueAt: new Date(due).toISOString(),
        eligibleAt: new Date(due).toISOString(),
        lastReviewedAt: new Date(due - 30 * DAY).toISOString(),
        weight: 1,
        retention: r.next(),
      };
    });
    const out = projectReviews({
      candidates,
      currentMonday: weekKeyToDate(NOW),
      examMonday: weekKeyToDate(weeksOn(NOW, 30)),
      weeklyBudget: reviewBudget(5),
    });
    const weeks = new Map<string, string[]>();
    for (const b of out.bands)
      weeks.set(b.startWeek, [
        ...(weeks.get(b.startWeek) ?? []),
        ...(b.points ?? []).map((p) => p.specPointId),
      ]);
    const counts = [...weeks.entries()].sort().map(([, ids]) => ids.length);
    expect(REVIEW_SHARE).toBe(3);
    expect(Math.max(...counts)).toBe(15);
    expect(counts.reduce((a, b) => a + b, 0) + out.backlog.length).toBe(250);
    expect(out.backlog).toHaveLength(0);
    // Oldest due first: week order follows id order.
    expect([...weeks.entries()].sort().flatMap(([, ids]) => ids.sort())).toEqual(
      candidates.map((c) => c.specPointId),
    );
  });
});

describe("catch-up (trickle and fair share)", () => {
  const owed = (i: number, weight: number, plannedWeek: string): BacklogPoint => ({
    specPointId: `c${String(i).padStart(3, "0")}`,
    topicId: `t${i % 5}`,
    topicTitle: `Topic ${i % 5}`,
    code: `${1 + (i % 5)}.${i}`,
    title: `P${i}`,
    weight,
    plannedWeek,
  });

  test("B2 · 1,500 trickles: oldest first, an oversized first point is still taken, a zero budget takes nothing", () => {
    const tally = new Tally();
    for (let seed = 0; seed < 1500; seed++) {
      const r = rng(210_000 + seed);
      const backlog = Array.from({ length: r.int(0, 40) }, (_, i) =>
        owed(i, r.pick(WEIGHTS), weeksOn(NOW, -r.int(1, 20))),
      );
      const budget = r.pick([0, 0.01, 0.2, 1, 4, 50]);
      const { take, held } = trickle(backlog, budget);
      const problems: string[] = [];
      if (JSON.stringify([...take, ...held]) !== JSON.stringify(backlog))
        problems.push("order changed or a point lost");
      if (budget === 0 && take.length) problems.push("took work on a zero budget");
      if (budget > 0 && backlog.length && take.length === 0)
        problems.push("took nothing although there is a budget");
      const spent = take.reduce((s, p) => s + p.weight, 0);
      if (take.length > 1 && spent > budget + 1e-9)
        problems.push(`took ${spent} against ${budget}`);
      tally.check(210_000 + seed, problems);
    }
    expect(tally.failed, tally.report("B2")).toBe(0);
  });

  function catchUpCase(r: Rng, opts: { tutorBlocks: boolean }) {
    const n = r.pick([0, 1, 10, 60, 250]);
    const backlog = Array.from({ length: n }, (_, i) =>
      owed(
        i,
        r.bool(0.05) ? r.int(8, 40) : r.pick(WEIGHTS),
        weeksOn(NOW, -1 - Math.floor((n - i) / 4)),
      ),
    );
    const weeksLeft = r.pick([0, 1, 2, 3, 6, 12, 30]);
    const examDate = weeksOn(NOW, weeksLeft);
    const weeklyWeight = r.pick([0, 0.3, 4, 20]);
    const breakFrom = r.bool(0.5) ? r.int(0, Math.max(0, weeksLeft - 1)) : -1;
    const offWeeks = new Set(
      breakFrom >= 0
        ? Array.from({ length: r.int(1, 4) }, (_, i) => weeksOn(NOW, breakFrom + i))
        : [],
    );
    const closed = new Set<string>();
    const skipped = new Set<string>();
    if (opts.tutorBlocks)
      for (const p of backlog) {
        if (r.bool(0.04)) skipped.add(p.specPointId);
        // A tutor's "remove" on the last weeks before the exam.
        if (r.bool(0.1))
          for (let w = Math.max(0, weeksLeft - r.int(1, 4)); w < weeksLeft; w++)
            closed.add(`${p.specPointId}|${weeksOn(NOW, w)}`);
      }
    const isBlocked = (id: string, week: string) =>
      offWeeks.has(week) || skipped.has(id) || closed.has(`${id}|${week}`);
    const assigned = r.bool(0.3) ? backlog.slice(0, r.int(0, Math.min(4, n))) : [];
    return { backlog, examDate, weeklyWeight, isBlocked, assigned, weeksLeft, offWeeks };
  }

  const run = (name: string, base: number, tutorBlocks: boolean) =>
    test(
      name,
      () => {
        const tally = new Tally();
        let stranded = 0;
        for (let seed = 0; seed < 2000; seed++) {
          const r = rng(base + seed);
          const c = catchUpCase(r, { tutorBlocks });
          const problems: string[] = [];
          try {
            const out = projectCatchUp({
              backlog: c.backlog,
              assigned: c.assigned,
              weekStart: NOW,
              examDate: c.examDate,
              weeklyWeight: c.weeklyWeight,
              isBlocked: c.isBlocked,
            });
            const reserved = new Set(c.assigned.map((p) => p.specPointId));
            const where = new Map<string, string>();
            for (const [week, points] of Object.entries(out.weeks))
              for (const p of points) {
                if (reserved.has(p.specPointId) && week === NOW) continue;
                if (where.has(p.specPointId)) problems.push(`${p.specPointId} scheduled twice`);
                where.set(p.specPointId, week);
                if (week >= c.examDate)
                  problems.push(`${p.specPointId} scheduled in/after the exam week`);
                if (c.isBlocked(p.specPointId, week))
                  problems.push(`${p.specPointId} scheduled in a week closed to it (${week})`);
              }
            const todo = c.backlog.filter((p) => !reserved.has(p.specPointId));
            for (const h of out.held)
              if (where.has(h.specPointId))
                problems.push(`${h.specPointId} both held and scheduled`);
            if (where.size + out.held.length !== todo.length)
              problems.push(`${todo.length - where.size - out.held.length} owed points vanished`);
            // Oldest first: nobody jumps an older point that could have gone in the same week.
            const order = new Map(todo.map((p, i) => [p.specPointId, i]));
            for (const [id, week] of where)
              for (const older of todo.slice(0, order.get(id)!)) {
                const w = where.get(older.specPointId);
                if ((w === undefined || w > week) && !c.isBlocked(older.specPointId, week)) {
                  problems.push(`${id} went in ${week} ahead of the older ${older.specPointId}`);
                  break;
                }
              }
            // Held only when there was truly nowhere to put it.
            const weeks = Array.from({ length: c.weeksLeft }, (_, i) => weeksOn(NOW, i));
            for (const h of out.held)
              if (weeks.some((w) => !c.isBlocked(h.specPointId, w))) {
                stranded++;
                problems.push(
                  `${h.specPointId} left unscheduled although a week before the exam was open to it`,
                );
                break;
              }
          } catch (e) {
            problems.push(`threw: ${(e as Error).message}`);
          }
          tally.check(base + seed, problems);
        }
        console.log(
          `[${name.slice(0, 3)}] cases where an owed point was stranded with an open week available: ${stranded}/${tally.cases}`,
        );
        expect(tally.failed, tally.report(name.slice(0, 3))).toBe(0);
      },
      LONG,
    );

  run(
    "B3 · 2,000 backlogs of 0–250 points with 1–4 break weeks: nothing lost, nothing in a break, everything clears before the exam",
    220_000,
    false,
  );
  run(
    "B4 · A4: the same with a tutor's remove/skip on single points in the last weeks before the exam",
    230_000,
    true,
  );
});

describe("admission and tutor overrides", () => {
  const origins: PointOrigin[] = ["ai", "student", "tutor", "carried_over", "core", "focus"];

  test("B5 · 3,000 admission questions: the order of the rules never changes (orphan → off-course → past the exam → pinned → ahead → no evidence)", () => {
    const tally = new Tally();
    for (let seed = 0; seed < 3000; seed++) {
      const r = rng(240_000 + seed);
      const origin = r.pick(origins);
      const topicId = r.bool(0.1) ? null : "t1";
      const onCourse = r.pick([true, false, undefined]);
      const hasEvidence = r.pick([true, false, undefined]);
      const weekStart = weeksOn(NOW, r.int(-3, 6));
      const examDate = r.bool(0.85) ? weeksOn(NOW, r.int(-1, 8)) : null;
      const opens = r.bool(0.8) ? weeksOn(NOW, r.int(-4, 8)) : undefined;
      const reviewOpens = r.bool(0.5) ? weeksOn(NOW, r.int(-4, 8)) : undefined;
      const reach = new Map(opens ? [["t1", opens]] : []);
      const reviewReach = reviewOpens ? new Map([["t1", reviewOpens]]) : undefined;
      const got = admit(
        { specPointId: "p", topicId, origin, onCourse, hasEvidence },
        { reach, reviewReach, weekStart, examDate },
      );
      const hand = origin === "student" || origin === "tutor";
      const gate = origin === "focus" ? (reviewReach ?? reach).get("t1") : opens;
      const want = !topicId
        ? "orphaned"
        : onCourse === false
          ? "off-course"
          : examDate && weekStart >= examDate
            ? "beyond-exam"
            : hand
              ? undefined
              : gate && gate > weekStart
                ? "ahead-of-spine"
                : origin === "focus" && hasEvidence === false
                  ? "no-evidence"
                  : undefined;
      tally.check(
        240_000 + seed,
        got.reason === want && got.ok === !want
          ? []
          : [`${origin}: got ${got.reason ?? "ok"}, expected ${want ?? "ok"}`],
      );
    }
    expect(tally.failed, tally.report("B5")).toBe(0);
  });

  test("B6 · 3,000 weeks under remove/skip overrides: pinned work always stays, removed and skipped automatic work always goes, nothing unreported", () => {
    const tally = new Tally();
    for (let seed = 0; seed < 3000; seed++) {
      const r = rng(250_000 + seed);
      const ids = Array.from({ length: r.int(0, 40) }, (_, i) => `p${i}`);
      const sel = {
        specPointIds: ids,
        origins: Object.fromEntries(ids.map((id) => [id, r.pick(origins)])) as Record<
          string,
          PointOrigin
        >,
      };
      const overrides: PlanOverride[] = ids.flatMap((id, i) => {
        const out: PlanOverride[] = [];
        if (r.bool(0.2))
          out.push({
            id: `s${i}`,
            specPointId: id,
            kind: "skip",
            weekStart: null,
            note: null,
            createdBy: null,
            createdAt: "",
          });
        if (r.bool(0.25))
          out.push({
            id: `r${i}`,
            specPointId: id,
            kind: "remove",
            weekStart: r.bool(0.6) ? NOW : weeksOn(NOW, r.int(1, 3)),
            note: null,
            createdBy: null,
            createdAt: "",
          });
        return out;
      });
      const index = indexOverrides(overrides);
      const { selection, suppressed } = applyOverrides(sel, index, NOW);
      const kept = new Set(selection.specPointIds);
      const problems: string[] = [];
      for (const id of ids) {
        const hand = sel.origins[id] === "student" || sel.origins[id] === "tutor";
        const skip = overrides.some((o) => o.specPointId === id && o.kind === "skip");
        const removedNow = overrides.some(
          (o) => o.specPointId === id && o.kind === "remove" && o.weekStart === NOW,
        );
        const shouldStay = hand || (!skip && !removedNow);
        if (shouldStay !== kept.has(id))
          problems.push(
            `${id} (${sel.origins[id]}, skip=${skip}, removed=${removedNow}) ${kept.has(id) ? "stayed" : "went"}`,
          );
        if (!kept.has(id) && !suppressed.some((s) => s.specPointId === id))
          problems.push(`${id} dropped without a report`);
        if (kept.has(id) && selection.origins[id] !== sel.origins[id])
          problems.push(`${id} changed lane`);
        // The week's own removal is the one reported when both apply.
        if (
          !hand &&
          skip &&
          removedNow &&
          suppressed.find((s) => s.specPointId === id)?.override.kind !== "remove"
        )
          problems.push(`${id}: skip reported over the more specific remove`);
      }
      tally.check(250_000 + seed, problems);
    }
    expect(tally.failed, tally.report("B6")).toBe(0);
  });

  test("B7 · a week saved for another board or level is always seen as another course", () => {
    for (const board of ["aqa", "edexcel"])
      for (const level of ["gcse", "a_level"])
        for (const b2 of ["aqa", "edexcel"])
          for (const l2 of ["gcse", "a_level"])
            expect(weekIsForAnotherCourse({ board, level }, { board: b2, level: l2 })).toBe(
              board !== b2 || level !== l2,
            );
  });
});

describe("the re-cut merge (mergeWeek)", () => {
  const planOrigins: PlanPointOrigin[] = [
    "ai",
    "student",
    "tutor",
    "carried_over",
    "core",
    "focus",
  ];
  const noRepair = { unsupported: () => false, quarantined: [] as PlanPoint[] };
  const point = (
    id: string,
    origin: PlanPointOrigin,
    done: boolean,
    carried: boolean,
  ): PlanPoint => ({
    spec_point_id: id,
    code: id,
    title: id,
    description: null,
    topic_id: "t",
    topic_title: "T",
    origin,
    carried_from: carried ? weeksOn(NOW, -1) : null,
    done_at: done ? "2026-11-24T10:00:00Z" : null,
  });

  function mergeCase(r: Rng, sizes: number[]) {
    const pool = Array.from({ length: 320 }, (_, i) => `p${String(i).padStart(3, "0")}`);
    const existing = r
      .shuffle(pool)
      .slice(0, r.pick(sizes))
      .map((id) => point(id, r.pick(planOrigins), r.bool(0.25), r.bool(0.1)));
    const coverage = new Map<string, PointCoverage>();
    for (const p of existing)
      if (r.bool(0.2))
        coverage.set(p.spec_point_id, {
          attempted: true,
          homeworkDone: false,
          quizDone: true,
          bestScore: 50,
          homeworkScore: null,
          quizScore: 50,
        });
    const freshIds = r.shuffle(pool).slice(0, r.pick(sizes));
    const fresh: WeekSelection = {
      specPointIds: freshIds,
      origins: Object.fromEntries(freshIds.map((id) => [id, r.pick(["core", "focus"] as const)])),
      rationale: "",
    };
    return { existing, coverage, fresh };
  }
  const protectedPoint = (p: PlanPoint, coverage: Map<string, PointCoverage>) =>
    p.origin === "student" ||
    p.origin === "tutor" ||
    !!p.done_at ||
    !!p.carried_from ||
    !!coverage.get(p.spec_point_id)?.attempted;

  test(
    "B8 · 3,000 re-cuts of weeks of 0–200 points: student work and pins always survive in their own lane, never over 200, a second re-cut changes nothing",
    () => {
      const tally = new Tally();
      for (let seed = 0; seed < 3000; seed++) {
        const r = rng(260_000 + seed);
        const c = mergeCase(r, [0, 1, 12, 60, 150, 200]);
        const problems: string[] = [];
        try {
          const merged = mergeWeek({
            existing: { points: c.existing, withheld: [] },
            fresh: c.fresh,
            coverage: c.coverage,
            roadmap: null,
            repair: noRepair,
          });
          const ids = merged ? merged.specPointIds : c.existing.map((p) => p.spec_point_id);
          const originOf = (id: string) =>
            merged ? merged.origins[id] : c.existing.find((p) => p.spec_point_id === id)!.origin;
          if (ids.length > MAX_WEEK_POINTS) problems.push(`${ids.length} points in the week`);
          if (new Set(ids).size !== ids.length) problems.push("a point twice in the week");
          const kept = c.existing.filter((p) => protectedPoint(p, c.coverage));
          if (kept.length <= MAX_WEEK_POINTS)
            for (const p of kept) {
              if (!ids.includes(p.spec_point_id))
                problems.push(
                  `${p.spec_point_id} (${p.origin}, done=${!!p.done_at}) was dropped by the re-cut`,
                );
              else if (originOf(p.spec_point_id) !== p.origin)
                problems.push(
                  `${p.spec_point_id} moved lane ${p.origin} → ${originOf(p.spec_point_id)}`,
                );
            }
          for (const id of ids)
            if (!c.fresh.specPointIds.includes(id) && !kept.some((p) => p.spec_point_id === id))
              problems.push(`${id} is in the week but neither kept nor freshly cut`);
          if (merged) {
            const before = new Map(c.existing.map((p) => [p.spec_point_id, p]));
            const saved = merged.specPointIds.map((id) => ({
              ...(before.get(id) ?? point(id, merged.origins[id], false, false)),
              origin: merged.origins[id],
              carried_from: merged.carriedFroms[id] ?? null,
            }));
            if (
              mergeWeek({
                existing: { points: saved, withheld: [] },
                fresh: c.fresh,
                coverage: c.coverage,
                roadmap: null,
                repair: noRepair,
              }) !== null
            )
              problems.push("a second re-cut with nothing new still wants to write");
          }
        } catch (e) {
          problems.push(`threw: ${(e as Error).message}`);
        }
        tally.check(260_000 + seed, problems);
      }
      expect(tally.failed, tally.report("B8")).toBe(0);
    },
    LONG,
  );

  test("B9 · 2,000 stale previews: a preview that no longer matches is always refused, one that matches always goes through", () => {
    const tally = new Tally();
    for (let seed = 0; seed < 2000; seed++) {
      const r = rng(270_000 + seed);
      const c = mergeCase(r, [0, 3, 20, 80]);
      const args = {
        existing: { points: c.existing, withheld: [] },
        fresh: c.fresh,
        coverage: c.coverage,
        roadmap: null,
        repair: noRepair,
      };
      const problems: string[] = [];
      const truth = mergeWeek(args);
      const expected = truth ? truth.specPointIds : c.existing.map((p) => p.spec_point_id);
      try {
        mergeWeek({ ...args, expectedPointIds: r.shuffle(expected) });
      } catch {
        problems.push("a matching preview was refused");
      }
      // What a second tab does: one point more, one fewer, or one swapped.
      const stale = r.pick([
        [...expected, "other-tab"],
        expected.slice(1),
        ["other-tab", ...expected.slice(1)],
      ]);
      if (JSON.stringify([...stale].sort()) !== JSON.stringify([...expected].sort())) {
        let threw = false;
        try {
          mergeWeek({ ...args, expectedPointIds: stale });
        } catch {
          threw = true;
        }
        if (!threw) problems.push("a stale preview was accepted");
      }
      tally.check(270_000 + seed, problems);
    }
    expect(tally.failed, tally.report("B9")).toBe(0);
  });

  test("B10 · a week already over the cap (230 points, as a direct write can make it): what the re-cut does with it", () => {
    const r = rng(7);
    const existing = Array.from({ length: 230 }, (_, i) =>
      point(`p${String(i).padStart(3, "0")}`, "core", true, false),
    );
    const fresh: WeekSelection = {
      specPointIds: ["new1", "new2"],
      origins: { new1: "core", new2: "core" },
      rationale: "",
    };
    const merged = mergeWeek({
      existing: { points: r.shuffle(existing), withheld: [] },
      fresh,
      coverage: new Map(),
      roadmap: null,
      repair: noRepair,
    });
    console.log(
      `[B10] 230 ticked points + 2 new: the re-cut writes ${merged?.specPointIds.length ?? "nothing"} points; ticked points it leaves out of the write: ${merged ? 230 - merged.specPointIds.filter((id) => id.startsWith("p")).length : 0}`,
    );
    expect(merged?.specPointIds.length ?? 0).toBeLessThanOrEqual(MAX_WEEK_POINTS);
  });

  test("B11 · catch-up budget is a fifth of a week and never negative", () => {
    for (const w of [-5, 0, 0.1, 3.3, 40, NaN]) {
      const b = catchUpBudget(w);
      expect(Number.isNaN(w) ? true : b >= 0 && Math.abs(b - Math.max(0, w) * 0.2) < 1e-12).toBe(
        true,
      );
    }
  });
});

describe("the weekly check-in lock (reviewLock)", () => {
  test("B12 · every day of 2026–2027 at four times of day: shut Monday to Saturday, open from Sunday's UK midnight, open early only when every task is in", async () => {
    const { reviewLock } = await import("../reviewLock");
    const { mondayOf, toDateKey } = await import("../week");
    const tally = new Tally();
    const entry = (done: boolean) => ({
      coverage: { homeworkDone: done } as PointCoverage,
      activity: { hasHomework: true } as never,
    });
    for (let day = Date.UTC(2026, 0, 1); day < Date.UTC(2028, 0, 1); day += DAY)
      for (const offset of [5 * 60_000, 9 * 3_600_000, 23 * 3_600_000 + 50 * 60_000, 30 * 60_000]) {
        const now = new Date(day + offset);
        const weekStart = toDateKey(mondayOf(now));
        const sunday = new Date(`${toDateKey(now)}T00:00:00Z`).getUTCDay() === 0;
        const problems: string[] = [];
        const none = reviewLock({ weekStart, entries: [], now });
        const some = reviewLock({ weekStart, entries: [entry(true), entry(false)], now });
        const all = reviewLock({ weekStart, entries: [entry(true), entry(true)], now });
        if (none.locked !== !sunday)
          problems.push(
            `no tasks set: locked=${none.locked} on a ${sunday ? "Sunday" : "weekday"}`,
          );
        if (some.locked !== !sunday) problems.push(`one task still out: locked=${some.locked}`);
        if (all.locked) problems.push("every task handed in but the check-in is still shut");
        if (reviewLock({ weekStart: weeksOn(weekStart, -1), entries: [], now }).locked)
          problems.push("a past week's check-in is shut");
        tally.check(now.toISOString(), problems);
      }
    expect(tally.failed, tally.report("B12")).toBe(0);
  });
});
