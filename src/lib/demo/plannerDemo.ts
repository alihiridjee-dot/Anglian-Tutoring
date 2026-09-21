import type { PlanPoint, WeeklyPlan } from "@/lib/planner/weeklyPlanDal";
import type { PointActivity, PointCoverage, PointWork } from "@/lib/planner/coverage";
import type { SubjectV } from "@/lib/curriculum/taxonomy";
import { currentWeekKey } from "@/lib/planner/week";
import { DEMO_ENROLMENTS, DEMO_MCQ_SETS, DEMO_YT } from "./studentDemo";

/**
 * The showcase's weekly plan.
 *
 * A real student's week is built by `useWeekPlan`, which saves plans, repairs
 * them and generates any missing homework or quiz. None of that may run for a
 * visitor, so the demo never mounts it. These fixtures are handed straight to
 * the planner's presentational panels (`ThisWeekPanel`, `DoNowPanel`), which
 * take their data as props — the same UI, with nothing behind it.
 *
 * Every id resolves inside the demo: quizzes are DEMO_MCQ sets, homework ids are
 * DEMO_HOMEWORK sheets, and videos are real YouTube links.
 */

export type DemoWeek = {
  plan: WeeklyPlan;
  points: PlanPoint[];
  activity: Map<string, PointActivity & PointWork>;
  coverage: Map<string, PointCoverage>;
};

type Work = {
  video?: [title: string, url: string];
  quiz?: string;
  homework?: [id: string, title: string];
};

type PointSeed = {
  id: string;
  code: string;
  title: string;
  topicId: string;
  topicTitle: string;
  lane: "core" | "focus";
  done?: boolean;
  work: Work;
  /** Already practised: the best mark on it, for the coverage pill. */
  score?: { quiz?: number; homework?: number };
};

const SEEDS: Record<SubjectV, { rationale: string; points: PointSeed[] }> = {
  biology: {
    rationale:
      "Cell Biology is on schedule. Two earlier points come back for revision because their quiz marks were the lowest this half-term.",
    points: [
      {
        id: "demo-sp-transport",
        code: "4.1.3",
        title: "Transport in cells",
        topicId: "demo-topic-cells",
        topicTitle: "Cell Biology",
        lane: "core",
        work: {
          video: ["Diffusion, Osmosis & Active Transport", DEMO_YT.transport],
          quiz: "demo-mcq-transport",
          homework: ["demo-hw-osmosis", "4.1.3 Osmosis"],
        },
      },
      {
        id: "demo-sp-osmosis-practical",
        code: "RP3",
        title: "Required practical: osmosis in potato",
        topicId: "demo-topic-cells",
        topicTitle: "Cell Biology",
        lane: "core",
        done: true,
        work: { video: ["Required Practical: Osmosis", DEMO_YT.osmosis] },
      },
      {
        id: "demo-sp-cell-division",
        code: "4.1.2",
        title: "Cell division & mitosis",
        topicId: "demo-topic-cells",
        topicTitle: "Cell Biology",
        lane: "focus",
        done: true,
        work: {
          video: ["Cell Division by Mitosis", DEMO_YT.mitosis],
          quiz: "demo-mcq-mitosis",
          homework: ["demo-hw-mitosis", "Cell Division & the Cell Cycle"],
        },
        score: { quiz: 80, homework: 92 },
      },
      {
        id: "demo-sp-photosynthesis",
        code: "4.4.1",
        title: "Photosynthesis",
        topicId: "demo-topic-bioenergetics",
        topicTitle: "Bioenergetics",
        lane: "focus",
        work: {
          video: ["Photosynthesis: Limiting Factors", DEMO_YT.photosynthesis],
          quiz: "demo-mcq-bioenergetics",
          homework: ["demo-hw-photosynthesis", "Photosynthesis: Limiting Factors"],
        },
        score: { quiz: 80, homework: 88 },
      },
    ],
  },
  chemistry: {
    rationale:
      "Bonding starts this week. Atomic structure returns for a short revision pass before the end-of-topic test.",
    points: [
      {
        id: "demo-sp-ionic",
        code: "5.2.1",
        title: "Ionic bonding",
        topicId: "demo-topic-bonding",
        topicTitle: "Bonding, Structure & Properties",
        lane: "core",
        work: {
          video: ["Properties of Ionic Compounds", DEMO_YT.ionic],
          quiz: "demo-mcq-bonding",
        },
      },
      {
        id: "demo-sp-covalent",
        code: "5.2.2",
        title: "Covalent bonding",
        topicId: "demo-topic-bonding",
        topicTitle: "Bonding, Structure & Properties",
        lane: "core",
        work: { video: ["Covalent Bonding", DEMO_YT.covalent] },
      },
      {
        id: "demo-sp-atoms",
        code: "5.1.1",
        title: "Atoms & isotopes",
        topicId: "demo-topic-atomic",
        topicTitle: "Atomic Structure & the Periodic Table",
        lane: "focus",
        done: true,
        work: {
          video: ["Elements, Isotopes & Relative Atomic Mass", DEMO_YT.isotopes],
          quiz: "demo-mcq-atomic",
        },
        score: { quiz: 80 },
      },
    ],
  },
  physics: {
    rationale:
      "Electricity is on schedule. Energy stores come back for revision — last quiz was 60%, so it's worth another pass.",
    points: [
      {
        id: "demo-sp-circuits",
        code: "6.2.1",
        title: "Circuits & I–V characteristics",
        topicId: "demo-topic-electricity",
        topicTitle: "Electricity",
        lane: "core",
        work: {
          video: ["Voltage, Current & Resistance — I–V Graphs", DEMO_YT.ivGraphs],
          quiz: "demo-mcq-electricity",
          homework: ["demo-hw-electricity", "Electricity: I–V Characteristics"],
        },
      },
      {
        id: "demo-sp-series",
        code: "6.2.2",
        title: "Series & parallel circuits",
        topicId: "demo-topic-electricity",
        topicTitle: "Electricity",
        lane: "core",
        work: { video: ["Lamps in Series & Parallel", DEMO_YT.seriesParallel] },
      },
      {
        id: "demo-sp-energy-stores",
        code: "6.1.1",
        title: "Energy stores & transfers",
        topicId: "demo-topic-energy",
        topicTitle: "Energy",
        lane: "focus",
        work: {
          video: ["Energy Stores: a Worked Example", DEMO_YT.energyStores],
          quiz: "demo-mcq-energy",
        },
        score: { quiz: 60 },
      },
    ],
  },
};

const quizTitle = (id: string) => DEMO_MCQ_SETS.find((s) => s.id === id)?.title ?? "Quiz";

/** This week's plan for one subject, built fresh so the dates never go stale. */
export function demoWeek(subject: SubjectV): DemoWeek {
  const weekStart = currentWeekKey();
  const seed = SEEDS[subject];
  const board = DEMO_ENROLMENTS.find((e) => e.subject === subject)?.board ?? "aqa";

  const points: PlanPoint[] = seed.points.map((p) => ({
    spec_point_id: p.id,
    code: p.code,
    title: p.title,
    description: null,
    topic_id: p.topicId,
    topic_title: p.topicTitle,
    origin: p.lane,
    carried_from: null,
    done_at: p.done ? new Date().toISOString() : null,
  }));

  const activity = new Map<string, PointActivity & PointWork>(
    seed.points.map((p) => [
      p.id,
      {
        hasHomework: !!p.work.homework,
        hasQuiz: !!p.work.quiz,
        videos: p.work.video
          ? [{ id: `${p.id}-video`, title: p.work.video[0], videoUrl: p.work.video[1] }]
          : [],
        homework: p.work.homework ? [{ id: p.work.homework[0], title: p.work.homework[1] }] : [],
        quizzes: p.work.quiz ? [{ id: p.work.quiz, title: quizTitle(p.work.quiz) }] : [],
      },
    ]),
  );

  const coverage = new Map<string, PointCoverage>(
    seed.points
      .filter((p) => p.score)
      .map((p) => {
        const quizScore = p.score?.quiz ?? null;
        const homeworkScore = p.score?.homework ?? null;
        const scores = [quizScore, homeworkScore].filter((n): n is number => n != null);
        return [
          p.id,
          {
            attempted: true,
            quizDone: quizScore != null,
            homeworkDone: homeworkScore != null,
            quizScore,
            homeworkScore,
            bestScore: scores.length ? Math.max(...scores) : null,
          },
        ];
      }),
  );

  return {
    plan: {
      id: `demo-plan-${subject}`,
      subject,
      board: board as WeeklyPlan["board"],
      level: "gcse",
      week_start: weekStart,
      source: "ai",
      note: null,
      ai_rationale: seed.rationale,
    },
    points,
    activity,
    coverage,
  };
}

/**
 * The road to the exam, one row per topic, for the demo planner page. Weeks are
 * counted from this Monday so the current topic is always "this week".
 */
export type DemoRoadTopic = {
  code: string;
  title: string;
  /** Weeks from now the topic starts (negative = already under way or done). */
  startsIn: number;
  weeks: number;
  /** Share of the topic's spec points practised with a mark. */
  mastery: number;
};

export const DEMO_ROADMAP: Record<SubjectV, DemoRoadTopic[]> = {
  biology: [
    { code: "B1", title: "Cell Biology", startsIn: -2, weeks: 4, mastery: 68 },
    { code: "B2", title: "Organisation", startsIn: 2, weeks: 4, mastery: 0 },
    { code: "B3", title: "Infection & Response", startsIn: 6, weeks: 3, mastery: 0 },
    { code: "B4", title: "Bioenergetics", startsIn: -9, weeks: 3, mastery: 84 },
    { code: "B5", title: "Homeostasis & Response", startsIn: 9, weeks: 4, mastery: 0 },
  ],
  chemistry: [
    {
      code: "C1",
      title: "Atomic Structure & the Periodic Table",
      startsIn: -4,
      weeks: 4,
      mastery: 80,
    },
    { code: "C2", title: "Bonding, Structure & Properties", startsIn: 0, weeks: 4, mastery: 12 },
    { code: "C3", title: "Quantitative Chemistry", startsIn: 4, weeks: 4, mastery: 0 },
    { code: "C6", title: "Rate of Chemical Change", startsIn: 8, weeks: 3, mastery: 0 },
  ],
  physics: [
    { code: "P1", title: "Energy", startsIn: -5, weeks: 4, mastery: 60 },
    { code: "P2", title: "Electricity", startsIn: -1, weeks: 5, mastery: 25 },
    { code: "P3", title: "Particle Model of Matter", startsIn: 4, weeks: 3, mastery: 0 },
    { code: "P4", title: "Atomic Structure", startsIn: 7, weeks: 3, mastery: 0 },
  ],
};
