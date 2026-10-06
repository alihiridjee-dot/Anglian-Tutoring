import { describe, expect, test } from "bun:test";
import { STRONG_THRESHOLD } from "@/lib/planner/coverage";
import type { SubjectV } from "@/lib/curriculum/taxonomy";
import {
  DEMO_HOLIDAY_WEEKS,
  DEMO_ROADMAP,
  DEMO_WEEK_SEEDS,
  DEMO_WEEKS_TO_EXAMS,
  OPTIONAL_QUIZZES,
  demoQuizPct,
  demoTaskState,
  demoWeek,
} from "./plannerDemo";
import {
  DEMO_HOMEWORK,
  DEMO_MCQ,
  DEMO_MCQ_ATTEMPTS,
  DEMO_MCQ_SETS,
  DEMO_MCQ_SETS_LATER,
  DEMO_QUESTIONS,
} from "./studentDemo";

const SUBJECTS = Object.keys(DEMO_WEEK_SEEDS) as SubjectV[];
const seeds = SUBJECTS.flatMap((s) => DEMO_WEEK_SEEDS[s].points);
const quizzes = [...new Set(seeds.flatMap((p) => (p.work.quiz ? [p.work.quiz] : [])))];
const tasks = [...new Set(seeds.flatMap((p) => (p.work.task ? [p.work.task] : [])))];

describe("the demo week's work exists", () => {
  test("every quiz the planner names is a demo quiz, bar the optional ones", () => {
    const missing = quizzes.filter(
      (id) =>
        !OPTIONAL_QUIZZES.has(id) && !(DEMO_MCQ_SETS.some((s) => s.id === id) && DEMO_MCQ[id]),
    );
    expect(missing).toEqual([]);
  });

  test("every task the planner names is a demo task with questions on it", () => {
    expect(tasks.filter((id) => !DEMO_HOMEWORK.some((h) => h.id === id))).toEqual([]);
    expect(tasks.filter((id) => !DEMO_QUESTIONS[id]?.length)).toEqual([]);
  });

  test("every point has a quiz and a task, so the task list has no gaps", () => {
    const gaps = seeds.filter((p) => !p.work.quiz || !p.work.task).map((p) => p.code);
    expect(gaps).toEqual([]);
  });

  test("a quiz the MCQ page files under this week is on this week's plan", () => {
    const stray = DEMO_MCQ_SETS.filter((s) => s.thisWeek && !quizzes.includes(s.id));
    expect(stray.map((s) => s.id)).toEqual([]);
  });
});

describe("the demo week agrees with the fixtures", () => {
  for (const subject of SUBJECTS) {
    test(`${subject}: marks come from the quiz attempts and task submissions`, () => {
      const week = demoWeek(subject);
      for (const p of week.points) {
        const work = week.activity.get(p.spec_point_id)!;
        const c = week.coverage.get(p.spec_point_id);
        const quiz = work.quizzes[0]?.id;
        const task = work.homework[0]?.id;
        expect(c?.quizScore ?? null).toBe(quiz ? demoQuizPct(quiz) : null);
        expect(c?.homeworkDone ?? false).toBe(task ? demoTaskState(task).handedIn : false);
        expect(c?.homeworkScore ?? null).toBe(task ? demoTaskState(task).pct : null);
        // Ticked exactly when all its work is in.
        const allIn =
          (!quiz || c?.quizDone === true) &&
          (!task || c?.homeworkDone === true) &&
          !!(quiz || task);
        expect({ code: p.code, ticked: !!p.done_at }).toEqual({ code: p.code, ticked: allIn });
      }
    });
  }

  test("revision in Biology and Chemistry is spaced, so those points are secure", () => {
    for (const subject of ["biology", "chemistry"] as const) {
      const week = demoWeek(subject);
      const revision = week.points.filter((p) => p.origin === "focus");
      expect(revision.length).toBeGreaterThan(0);
      for (const p of revision) {
        const best = week.coverage.get(p.spec_point_id)?.bestScore ?? 0;
        expect({ code: p.code, secure: best >= STRONG_THRESHOLD }).toEqual({
          code: p.code,
          secure: true,
        });
      }
    }
  });

  test("Physics brings energy stores back because its quiz was weak, and says the mark", () => {
    const pct = demoQuizPct("demo-mcq-energy");
    expect(pct).not.toBeNull();
    expect(pct!).toBeLessThan(STRONG_THRESHOLD);
    expect(DEMO_WEEK_SEEDS.physics.rationale).toContain(`its quiz was ${pct}%`);
  });

  test("only Physics has missed work returning, planned for a week its topic was running", () => {
    for (const subject of SUBJECTS) {
      const week = demoWeek(subject);
      const back = week.roadmap.catchUpSchedule?.weeks[week.plan.week_start] ?? [];
      if (subject !== "physics") {
        expect(back).toEqual([]);
        continue;
      }
      expect(back.map((b) => b.code)).toEqual(["6.2.1"]);
      const monday = new Date(`${week.plan.week_start}T00:00:00Z`).getTime();
      for (const b of back) {
        const weeksAgo = (monday - new Date(`${b.plannedWeek}T00:00:00Z`).getTime()) / 604_800_000;
        expect(weeksAgo).toBeGreaterThan(0);
        const row = DEMO_ROADMAP.physics.find((t) => t.title === b.topicTitle)!;
        expect(row.startsIn).toBeLessThanOrEqual(-weeksAgo);
        expect(week.points.find((p) => p.spec_point_id === b.specPointId)?.origin).toBe("core");
      }
      // Still owed only while nothing on it is marked, as the live ledger counts it.
      for (const b of week.roadmap.backlog)
        expect(week.coverage.get(b.specPointId)?.bestScore ?? null).toBeNull();
    }
  });
});

describe("the road to the exam", () => {
  for (const subject of SUBJECTS) {
    const road = [...DEMO_ROADMAP[subject]].sort((a, b) => a.startsIn - b.startsIn);
    const topics = road.filter((t) => t.code);

    test(`${subject}: every topic, numbered without gaps, then revision and mocks`, () => {
      const prefix = topics[0].code[0];
      const numbers = topics.map((t) => Number(t.code.slice(1))).sort((a, b) => a - b);
      expect(topics.every((t) => t.code[0] === prefix)).toBe(true);
      expect(numbers).toEqual(numbers.map((_, i) => i + 1));
      const last = road.at(-1)!;
      expect(last.title).toBe("Revision & mocks");
      expect(last.startsIn + last.weeks).toBe(DEMO_WEEKS_TO_EXAMS);
    });

    test(`${subject}: September to the exams, no overlaps, nothing over a holiday`, () => {
      // Early September: the roadmap is laid out from the week of 5 October.
      expect(road[0].startsIn).toBe(-4);
      for (let i = 1; i < road.length; i++)
        expect(road[i].startsIn).toBeGreaterThanOrEqual(road[i - 1].startsIn + road[i - 1].weeks);
      for (const t of road)
        for (let w = t.startsIn; w < t.startsIn + t.weeks; w++)
          expect({ block: t.title, week: w, holiday: DEMO_HOLIDAY_WEEKS.includes(w) }).toEqual({
            block: t.title,
            week: w,
            holiday: false,
          });
    });

    test(`${subject}: this week's topic is the one the plan is teaching`, () => {
      const now = road.filter((t) => t.startsIn <= 0 && t.startsIn + t.weeks > 0);
      expect(now.length).toBe(1);
      const teaching = new Set(
        demoWeek(subject)
          .points.filter((p) => p.origin === "core")
          .map((p) => p.topic_title),
      );
      expect([...teaching]).toEqual([now[0].title]);
    });

    test(`${subject}: only topics already reached have marks`, () => {
      for (const t of road) {
        const done = t.startsIn + t.weeks <= 0;
        const future = t.startsIn > 0;
        if (done)
          expect({ topic: t.code, marked: t.mastery > 0 }).toEqual({ topic: t.code, marked: true });
        if (future)
          expect({ topic: t.code, mastery: t.mastery }).toEqual({ topic: t.code, mastery: 0 });
      }
    });

    test(`${subject}: no quiz has been taken on a topic still to come`, () => {
      const taken = [...DEMO_MCQ_SETS, ...DEMO_MCQ_SETS_LATER].filter(
        (s) => s.subject === subject && DEMO_MCQ_ATTEMPTS[s.id],
      );
      for (const s of taken) {
        const row = road.find((t) => t.title === s.topic);
        expect({ quiz: s.id, onRoad: !!row }).toEqual({ quiz: s.id, onRoad: true });
        expect({ quiz: s.id, reached: row!.startsIn <= 0 }).toEqual({ quiz: s.id, reached: true });
      }
    });
  }
});
