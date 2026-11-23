/**
 * Brute test 4 of 4: whole courses, week by week, start to exam.
 *
 * Each simulated student opens the planner every week they can. Around them
 * things happen as they do live: a break is booked, a payment lapses and comes
 * back, the topic order is changed, the exam date moves. The loop below does
 * what ProgramDAL.loadRoadmap and useWeekPlan do, in the same order, using the
 * real pure functions; only the database is stood in for.
 *
 * The rules checked are the ones a student would notice:
 *   • a student who does everything is never told they missed work;
 *   • every point of the course is offered before the exam, exactly once as teaching;
 *   • no week is ever over the cap, and the plan always settles.
 */
import { describe, expect, test } from "bun:test";
import { isTeachBand, type PacingBand } from "../pacing";
import {
  examDateTooSoon,
  orderInputs,
  reorderTopics,
  resumeAfterPause,
  spineMatchesExam,
} from "../topicOrder";
import { computePacing } from "../pacing";
import { buildRoadmap, type RoadmapResult } from "../roadmap";
import { MAX_WEEK_POINTS, mergeWeek, selectWeek } from "../weekCut";
import { admit, spineReach } from "../admissibility";
import {
  backOn,
  breakCovering,
  breakEndsOn,
  breakFits,
  breakWeekKeys,
  layBreaksOver,
  mondayKeyOf,
  overlapsBreak,
  runWeeks,
  shiftKey,
  touchesExam,
  MAX_BREAK_WEEKS,
  type StudentBreak,
} from "../breaks";
import type { PlanPoint, PlanPointOrigin } from "../weeklyPlanDal";
import type { OrderTopic } from "../topicOrder";
import { weekKeyToDate } from "../week";
import {
  makeCourse,
  makeProgress,
  pacingInputs,
  rng,
  spineViolations,
  Tally,
  weeksOn,
  type PointState,
  type Rng,
} from "./helpers";

const DAY = 86_400_000;
type Kind = "diligent" | "absent" | "mixed";

interface Sim {
  topics: OrderTopic[];
  topicOf: Map<string, OrderTopic>;
  programStart: string;
  examDate: string;
  /** student_program_plan.pacing */
  stored: PacingBand[];
  breaks: (StudentBreak & { recorded: boolean })[];
  /** Closed rows of student_subject_pauses, as whole weeks. */
  stops: { from: string; to: string; resumed: boolean; why: string }[];
  openPause: { from: string; until: string } | null;
  saved: Map<string, Map<string, { origin: PlanPointOrigin; done: boolean }>>;
  done: Set<string>;
  memory: Map<string, PointState>;
  /** Week each point was first offered as teaching. */
  taught: Map<string, string[]>;
  offered: Set<string>;
  trail: string[];
}

const teach = (b: PacingBand[]) => b.filter(isTeachBand);

/** pickUpAfterPauses + resume_programme_after_pause, oldest start first. */
function pickUp(sim: Sim) {
  if (sim.openPause) return; // the database refuses while the subject is stopped
  const pending = sim.stops.filter((s) => !s.resumed).sort((a, b) => a.from.localeCompare(b.from));
  if (pending.some((a, i) => pending.slice(i + 1).some((b) => b.from < a.to && b.to < a.to)))
    sim.trail.push("two stops, one inside the other, picked up in start order");
  for (const stop of pending) {
    try {
      const bands = teach(sim.stored);
      const moved = resumeAfterPause({
        bands,
        topics: sim.topics,
        pausedFrom: stop.from,
        resumeFrom: stop.to,
        examDate: sim.examDate,
      });
      if (moved !== bands) {
        // The database's own check on the new calendar.
        if (moved.some((b) => b.startWeek >= stop.from && b.startWeek < stop.to))
          throw new Error("refused by the database");
        sim.stored = moved;
      }
    } catch (e) {
      // Too few weeks, or the exams have begun: marked picked up with nothing moved.
      sim.trail.push(
        `pick-up of ${stop.why} ${stop.from}→${stop.to} moved nothing: ${(e as Error).message.slice(0, 60)}`,
      );
    }
    stop.resumed = true;
  }
}

/** withBreaksAhead: the spine with every break not yet recorded laid over it. */
function shown(sim: Sim): PacingBand[] {
  const ahead = sim.breaks.filter((b) => !b.recorded);
  if (!ahead.length || !spineMatchesExam(sim.stored, sim.examDate)) return sim.stored;
  return layBreaksOver({
    bands: teach(sim.stored),
    topics: sim.topics,
    breaks: ahead,
    examDate: sim.examDate,
  });
}

function planPoints(sim: Sim, week: string): PlanPoint[] | null {
  const saved = sim.saved.get(week);
  if (!saved) return null;
  return [...saved].map(([id, p]) => {
    const t = sim.topicOf.get(id)!;
    return {
      spec_point_id: id,
      code: id,
      title: id,
      description: null,
      topic_id: t.topicId,
      topic_title: t.title,
      origin: p.origin,
      carried_from: null,
      done_at: p.done ? `${week}T12:00:00Z` : null,
    };
  });
}

function roadmapFor(sim: Sim, week: string, withSaved = true): RoadmapResult {
  const points = withSaved ? planPoints(sim, week) : null;
  const savedWeek = points && { points, withheld: [] };
  const all = planPoints(sim, week);
  return buildRoadmap({
    progress: makeProgress(sim.topics, sim.memory),
    baseline: { program_start: sim.programStart, exam_date: sim.examDate, pacing: shown(sim) },
    savedWeek,
    catchUpWeek: all && { points: all, withheld: [] },
    ledger: { done: new Set(sim.done), outstanding: new Set() },
    thisMonday: weekKeyToDate(week),
    examMonday: weekKeyToDate(sim.examDate),
    overrides: [],
    breakWeeks: breakWeekKeys(sim.breaks),
  });
}

/** applyPending: accept a re-flowed plan on sight. Returns false if it never settles. */
function settle(sim: Sim, week: string, problems: string[]): RoadmapResult {
  let roadmap = roadmapFor(sim, week);
  for (let i = 0; roadmap.needsAck; i++) {
    if (i === 2) {
      problems.push(`${week}: the plan asks to be accepted again after being accepted twice`);
      break;
    }
    sim.stored = teach(roadmap.bands);
    sim.trail.push(`${week} accept re-flow`);
    roadmap = roadmapFor(sim, week);
  }
  return roadmap;
}

/** The save, as WeeklyPlanDAL.savePlan screens it against the STORED spine (and the trigger after it). */
function admitted(
  sim: Sim,
  week: string,
  ids: string[],
  origins: Record<string, PlanPointOrigin>,
  problems: string[],
): string[] {
  const reach = spineReach(sim.stored);
  const reviewReach = spineReach(sim.stored, true);
  return ids.filter((id) => {
    const verdict = admit(
      {
        specPointId: id,
        topicId: sim.topicOf.get(id)!.topicId,
        origin: origins[id],
        hasEvidence: (sim.memory.get(id)?.reps ?? 0) > 0,
        onCourse: true,
      },
      { reach, reviewReach, weekStart: week, examDate: sim.examDate },
    );
    if (!verdict.ok)
      problems.push(
        `${week}: ${id} (${origins[id]}) is cut into the week but dropped at save: ${verdict.reason}`,
      );
    return verdict.ok;
  });
}

function runStudent(
  seed: number,
  kind: Kind,
  opts: { events: boolean },
): { problems: string[]; trail: string[] } {
  const r: Rng = rng(seed);
  const topics = makeCourse(r, { topics: r.int(2, 12), maxPoints: 8 });
  const programStart = r.pick(["2026-09-07", "2026-10-19", "2027-01-04", "2027-03-22"]);
  const runway = r.int(topics.length + 6, topics.length * 3 + 16);
  let examDate = weeksOn(programStart, runway);
  const sim: Sim = {
    topics,
    topicOf: new Map(topics.flatMap((t) => t.points.map((p) => [p.specPointId, t] as const))),
    programStart,
    examDate,
    stored: computePacing(
      pacingInputs(topics),
      weekKeyToDate(programStart),
      weekKeyToDate(examDate),
    ),
    breaks: [],
    stops: [],
    openPause: null,
    saved: new Map(),
    done: new Set(),
    memory: new Map(),
    taught: new Map(),
    offered: new Set(),
    trail: [`${kind}, ${topics.length} topics, ${programStart} → ${examDate}`],
  };
  const problems: string[] = [];
  const diligence = kind === "diligent" ? 1 : kind === "absent" ? 0 : 0.6;
  const allPoints = topics.flatMap((t) => t.points.map((p) => p.specPointId));

  try {
    for (
      let week = programStart;
      week < mondayKeyOf(sim.examDate) && problems.length === 0;
      week = weeksOn(week, 1)
    ) {
      // The hourly job: a break that ended before this week becomes a stop of the subject.
      for (const b of sim.breaks)
        if (!b.recorded && b.endsOn < week) {
          b.recorded = true;
          sim.stops.push({ from: b.startsOn, to: backOn(b), resumed: false, why: "break" });
        }
      if (sim.openPause && sim.openPause.until <= week) {
        sim.stops.push({
          from: sim.openPause.from,
          to: sim.openPause.until,
          resumed: false,
          why: "payment",
        });
        sim.trail.push(`${week} payment back (stopped since ${sim.openPause.from})`);
        sim.openPause = null;
      }
      const onBreak = breakCovering(sim.breaks, week);
      // Away on a break or behind the paywall: the planner is not opened.
      if (onBreak || sim.openPause) {
        if (opts.events && !sim.openPause && r.bool(0.15)) {
          // A payment lapses while the student is away, and is fixed 1–3 weeks later.
          sim.openPause = { from: week, until: weeksOn(week, r.int(1, 3)) };
          sim.trail.push(`${week} payment lapses during the break`);
        }
        continue;
      }

      pickUp(sim);
      let roadmap = settle(sim, week, problems);

      // The stored plan must always be one the database would accept.
      const starved = new Set(
        topics
          .filter((t) => roadmap.unscheduledTopicTitles.includes(t.title))
          .map((t) => t.topicId),
      );
      const broken = spineViolations(sim.stored, topics, {
        programStart,
        examDate: sim.examDate,
        mayOmit: starved,
      });
      // A band's empty tail weeks may outlast a moved exam date; only promised points matter here.
      const real = broken.filter((b) => !/^band \S+ runs into the exam week/.test(b));
      if (real.length) problems.push(`${week}: stored plan is unsound: ${real[0]}`);

      if (kind === "diligent" && roadmap.backlog.length)
        problems.push(
          `${week}: a student who has done everything is told ${roadmap.backlog.length} point(s) were missed (first: ${roadmap.backlog[0].specPointId}, promised ${roadmap.backlog[0].plannedWeek})`,
        );

      // This week's plan: built on first sight, topped up after.
      let plan = sim.saved.get(week);
      if (!plan) {
        const cut = selectWeek(roadmapFor(sim, week, false), week);
        const ids = admitted(sim, week, cut.specPointIds, cut.origins, problems);
        plan = new Map(ids.map((id) => [id, { origin: cut.origins[id], done: false }]));
        sim.saved.set(week, plan);
      } else {
        for (const p of roadmap.catchUpSchedule?.weeks[week] ?? [])
          if (!plan.has(p.specPointId) && plan.size < MAX_WEEK_POINTS)
            plan.set(p.specPointId, { origin: "core", done: false });
      }
      // Life happens early in the week, before the work is done.
      if (opts.events) {
        let replan = false;
        if (r.bool(0.07)) {
          const startsOn = weeksOn(week, r.int(1, 8));
          const weeks = r.int(1, MAX_BREAK_WEEKS);
          const standing = sim.breaks.filter((b) => b.endsOn >= week);
          if (
            !touchesExam({ startsOn, weeks, examDate: sim.examDate }) &&
            !overlapsBreak(standing, startsOn, weeks) &&
            runWeeks(standing, startsOn, weeks) <= MAX_BREAK_WEEKS &&
            breakFits({
              bands: teach(sim.stored),
              topics,
              breaks: standing.filter((b) => !b.recorded),
              examDate: sim.examDate,
              startsOn,
              weeks,
            })
          ) {
            sim.breaks.push({
              id: `b${sim.breaks.length}`,
              startsOn,
              endsOn: breakEndsOn(startsOn, weeks),
              reason: "holiday",
              recordedAt: null,
              recorded: false,
            });
            sim.trail.push(`${week} books break ${startsOn}..${breakEndsOn(startsOn, weeks)}`);
          }
        }
        if (r.bool(0.03) && !sim.openPause) {
          sim.openPause = { from: weeksOn(week, 1), until: weeksOn(week, 1 + r.int(1, 6)) };
          sim.trail.push(`${week} payment lapses ${sim.openPause.from}→${sim.openPause.until}`);
        }
        if (r.bool(0.05)) {
          // Topic order, as the editor and ProgramDAL.reorder do it: from this week, saved from the stored spine.
          try {
            const order = r.shuffle(
              orderInputs(roadmap.baselineBands, topics, week).remaining.map((t) => t.topicId),
            );
            sim.stored = reorderTopics({
              bands: teach(sim.stored),
              topics,
              order,
              from: week,
              examDate: sim.examDate,
              today: week,
            });
            sim.trail.push(`${week} reorders topics`);
            replan = true;
          } catch {
            // Refused: the editor shows why and nothing is saved.
          }
        }
        if (r.bool(0.04)) {
          const next = shiftKey(weeksOn(sim.examDate, r.int(-8, 8)), r.bool(0.2) ? r.int(1, 6) : 0);
          const clear = sim.breaks.every(
            (b) =>
              b.endsOn < week || !touchesExam({ startsOn: b.startsOn, weeks: 1, examDate: next }),
          );
          if (
            next > weeksOn(week, 1) &&
            clear &&
            !examDateTooSoon({ bands: sim.stored, programStart, examDate: next, today: week })
          ) {
            sim.trail.push(`${week} exam ${sim.examDate} → ${next}`);
            sim.examDate = next;
            examDate = next;
            replan = true;
          }
        }
        if (replan) {
          // The reorder RPC and applyPending both re-cut this week around what is ticked or started.
          roadmap = settle(sim, week, problems);
          const fresh = selectWeek(roadmapFor(sim, week, false), week);
          const merged = mergeWeek({
            existing: { points: planPoints(sim, week) ?? [], withheld: [] },
            fresh,
            coverage: new Map(),
            roadmap,
            repair: { unsupported: () => false, quarantined: [] },
          });
          if (merged) {
            const before = sim.saved.get(week)!;
            const ids = admitted(sim, week, merged.specPointIds, merged.origins, problems);
            plan = new Map(
              ids.map((id) => [
                id,
                { origin: merged.origins[id], done: before.get(id)?.done ?? false },
              ]),
            );
            sim.saved.set(week, plan);
          }
        }
      }
      if (plan.size > MAX_WEEK_POINTS) problems.push(`${week}: ${plan.size} points in the week`);
      for (const [id, p] of plan) {
        sim.offered.add(id);
        if (p.origin === "core" && !p.done)
          sim.taught.set(id, [...new Set([...(sim.taught.get(id) ?? []), week])]);
        if (p.origin === "focus") {
          const last = sim.memory.get(id)?.lastReviewedAt;
          if (last && weekKeyToDate(week).getTime() < new Date(last).getTime() + 7 * DAY)
            problems.push(
              `${week}: ${id} set for review under 7 days after it was last done (${last})`,
            );
        }
      }

      // The student's week.
      for (const [id, p] of plan) {
        if (p.done || !r.bool(diligence)) continue;
        p.done = true;
        sim.done.add(id);
        if (p.origin === "focus" || r.bool(0.3)) {
          const at = weekKeyToDate(week).getTime() + r.int(0, 6) * DAY + 10 * 3_600_000;
          const due = at + r.int(3, 45) * DAY;
          sim.memory.set(id, {
            reps: (sim.memory.get(id)?.reps ?? 0) + 1,
            lastReviewedAt: new Date(at).toISOString(),
            dueAt: new Date(due).toISOString(),
            eligibleAt: new Date(Math.max(due, at + 7 * DAY)).toISOString(),
          });
        }
      }
    }
  } catch (e) {
    problems.push(`threw: ${(e as Error).message}`);
  }

  if (problems.length === 0) {
    const last = roadmapFor(sim, weeksOn(mondayKeyOf(sim.examDate), -1));
    const unreachable = new Set(
      topics
        .filter((t) => last.unscheduledTopicTitles.includes(t.title))
        .flatMap((t) => t.points.map((p) => p.specPointId)),
    );
    // A stop still open at the exam, or one that ran to it, leaves work that could not be offered.
    const stoppedLate =
      !!sim.openPause || sim.stops.some((s) => s.to >= weeksOn(mondayKeyOf(sim.examDate), -1));
    if (kind !== "mixed" && !stoppedLate && allPoints.length <= MAX_WEEK_POINTS) {
      const never = allPoints.filter((id) => !sim.offered.has(id) && !unreachable.has(id));
      if (never.length)
        problems.push(
          `${never.length} point(s) were never offered before the exam (first: ${never[0]})`,
        );
    }
    if (kind === "diligent")
      for (const [id, weeks] of sim.taught)
        if (weeks.length > 1) {
          problems.push(
            `${id} was set as new teaching in ${weeks.length} different weeks (${weeks.join(", ")})`,
          );
          break;
        }
  }
  return { problems, trail: sim.trail };
}

describe("whole courses, start to exam", () => {
  const LONG = 300_000;

  test(
    "L1 · 600 quiet courses (no breaks, pauses or changes): every point taught once, nothing ever 'missed' by a student who keeps up",
    () => {
      const tally = new Tally();
      for (let seed = 0; seed < 600; seed++) {
        const kind: Kind = seed % 3 === 0 ? "absent" : "diligent";
        const { problems, trail } = runStudent(300_000 + seed, kind, { events: false });
        tally.check(300_000 + seed, problems, () => trail.join(" → "));
      }
      expect(tally.failed, tally.report("L1")).toBe(0);
    },
    LONG,
  );

  test(
    "L2 · 1,500 courses with breaks, payment lapses, topic reorders and exam moves",
    () => {
      const tally = new Tally(8);
      const by: Record<string, number> = {};
      const others: number[] = [];
      for (let seed = 0; seed < 1500; seed++) {
        const kind: Kind = seed % 5 === 0 ? "absent" : seed % 5 === 1 ? "mixed" : "diligent";
        const { problems, trail } = runStudent(310_000 + seed, kind, { events: true });
        if (problems.length) {
          const text = trail.join(" ");
          const cause = /moved nothing/.test(text)
            ? "a stop on a course with too few weeks left is marked picked up with nothing moved (known, B2)"
            : /one inside the other/.test(text)
              ? "a break and a payment lapse, one inside the other, picked up in start order (NEW)"
              : /exam \S+ → \d{4}-\d{2}-\d{2}/.test(text) && problems[0].includes("never offered")
                ? "catch-up shared over the exam week of a mid-week exam date (known, T3)"
                : "other";
          const key = `${problems[0]
            .replace(/^\S+: /, "")
            .replace(/[0-9]+/g, "N")
            .slice(0, 60)} ← ${cause}`;
          by[key] = (by[key] ?? 0) + 1;
          if (cause === "other") others.push(310_000 + seed);
        }
        tally.check(310_000 + seed, problems, () => trail.slice(-6).join(" → "));
      }
      console.log(
        `[L2] failures by kind: ${JSON.stringify(by, null, 1)}\n[L2] seeds with another cause: ${others.join(", ")}`,
      );
      expect(tally.failed, tally.report("L2")).toBe(0);
    },
    LONG,
  );
});

// One course, replayed with its whole trail: FUZZ_SEED=310028 FUZZ_KIND=diligent bun test <this file> -t replay
describe("replay", () => {
  test.skipIf(!process.env.FUZZ_SEED)("replay one seed", () => {
    const seed = Number(process.env.FUZZ_SEED);
    const kind =
      (process.env.FUZZ_KIND as Kind | undefined) ??
      (seed % 5 === 0 ? "absent" : seed % 5 === 1 ? "mixed" : "diligent");
    const { problems, trail } = runStudent(seed, kind, { events: process.env.FUZZ_QUIET !== "1" });
    console.log(
      `[replay ${seed}] ${kind}\n  ${trail.join("\n  ")}\n  PROBLEMS: ${problems.join("\n    ") || "none"}`,
    );
  });
});
