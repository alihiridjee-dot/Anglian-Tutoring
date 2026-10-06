import type { PlanPoint, WeeklyPlan } from "@/lib/planner/weeklyPlanDal";
import type { PointActivity, PointCoverage, PointWork } from "@/lib/planner/coverage";
import type { RoadmapResult } from "@/lib/planner/roadmap";
import type { BacklogPoint } from "@/lib/planner/backlog";
import type { SubjectV } from "@/lib/curriculum/taxonomy";
import { addWeeks, currentWeekKey, toDateKey, weekKeyToDate } from "@/lib/planner/week";
import {
  DEMO_CURRICULUM_CONTENT,
  DEMO_CURRICULUM_SPEC_POINTS,
  DEMO_CURRICULUM_TOPICS,
  DEMO_ENROLMENTS,
  DEMO_HOMEWORK,
  DEMO_MCQ_ATTEMPTS,
  DEMO_MCQ_SETS,
  DEMO_SUBMISSIONS,
  DEMO_YT,
} from "./studentDemo";

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
 * DEMO_HOMEWORK sheets, and videos are real YouTube links. Marks are never
 * written here: each point's quiz and task marks are read from DEMO_MCQ_ATTEMPTS
 * and DEMO_SUBMISSIONS, so the planner and the task and quiz pages can't
 * disagree. plannerDemo.test.ts holds every id to an existing fixture.
 */

export type DemoWeek = {
  plan: WeeklyPlan;
  points: PlanPoint[];
  activity: Map<string, PointActivity & PointWork>;
  coverage: Map<string, PointCoverage>;
  /**
   * Just enough of a programme for "Missed work returning": the points the
   * spine planned for an earlier week and that are back as catch-up.
   */
  roadmap: RoadmapResult;
};

type Work = {
  video?: [title: string, url: string];
  /** A DEMO_MCQ_SETS id. */
  quiz?: string;
  /** A DEMO_HOMEWORK id; the task's title comes from the fixture. */
  task?: string;
};

type PointSeed = {
  id: string;
  code: string;
  title: string;
  topicId: string;
  topicTitle: string;
  lane: "core" | "focus";
  /**
   * Catch-up: the spine planned this point this many weeks ago and it wasn't
   * practised that week, so it is back in this one. Catch-up points are core
   * work, as the live week cut files them.
   */
  missedWeeksAgo?: number;
  work: Work;
};

/**
 * Quizzes the planner may name before the data fixtures have them. A missing one
 * is left off the point rather than linking to a quiz that isn't there.
 */
export const OPTIONAL_QUIZZES: ReadonlySet<string> = new Set(["demo-mcq-osmosis-practical"]);

/** A quiz's best mark as a percentage, or null if Alex hasn't taken it. */
export function demoQuizPct(setId: string): number | null {
  const a = DEMO_MCQ_ATTEMPTS[setId];
  return a && a.total ? Math.round((a.score / a.total) * 100) : null;
}

/** A task as Alex left it: not handed in, handed in and being marked, or marked. */
export function demoTaskState(homeworkId: string): { handedIn: boolean; pct: number | null } {
  const s = DEMO_SUBMISSIONS[homeworkId];
  if (!s) return { handedIn: false, pct: null };
  // A mark still inside its review window isn't shown yet, as on the task page.
  const released = !s.release_at || Date.parse(s.release_at) <= Date.now();
  return {
    handedIn: true,
    pct: released && s.graded_at && s.score_pct != null ? Math.round(s.score_pct) : null,
  };
}

const energyQuiz = demoQuizPct("demo-mcq-energy");

/**
 * Each subject's week, in curriculum order as the live plan reads back.
 *
 * Every rationale claim is something the fixtures bear out; the test file checks
 * the marks behind them.
 */
export const DEMO_WEEK_SEEDS: Record<SubjectV, { rationale: string; points: PointSeed[] }> = {
  biology: {
    rationale:
      "Topic 1 is on schedule, with transport in cells and the osmosis core practical this week. Mitosis and photosynthesis come back for spaced revision, so they stay secure before the mocks.",
    points: [
      {
        id: "demo-sp-transport",
        code: "EDEX 1.15",
        title: "Active, Passive & Osmotic Transport",
        topicId: "demo-topic-cells",
        topicTitle: "Key concepts in biology",
        lane: "core",
        work: {
          video: ["Diffusion, Osmosis & Active Transport", DEMO_YT.transport],
          quiz: "demo-mcq-transport",
          task: "demo-hw-osmosis",
        },
      },
      {
        id: "demo-sp-osmosis-practical",
        code: "EDEX 1.16",
        title: "Core Practical – Osmosis in Potatoes",
        topicId: "demo-topic-cells",
        topicTitle: "Key concepts in biology",
        lane: "core",
        // The osmosis sheet is written for both EDEX 1.15 and the practical, so
        // it sits on both rows, as a sheet linked to two points does live.
        work: {
          video: ["Core Practical: Osmosis", DEMO_YT.osmosis],
          quiz: "demo-mcq-osmosis-practical",
          task: "demo-hw-osmosis",
        },
      },
      {
        id: "demo-sp-cell-division",
        code: "EDEX 2.1",
        title: "Mitosis and the Cell Cycle",
        topicId: "demo-topic-cell-control",
        topicTitle: "Cells and control",
        lane: "focus",
        work: {
          video: ["Cell Division by Mitosis", DEMO_YT.mitosis],
          quiz: "demo-mcq-mitosis",
          task: "demo-hw-mitosis",
        },
      },
      {
        id: "demo-sp-photosynthesis",
        code: "EDEX 6.3",
        title: "Rate Limiting Factors on Photosynthesis",
        topicId: "demo-topic-bioenergetics",
        topicTitle: "Plant structures and their functions",
        lane: "focus",
        work: {
          video: ["Photosynthesis: Limiting Factors", DEMO_YT.photosynthesis],
          quiz: "demo-mcq-bioenergetics",
          task: "demo-hw-photosynthesis",
        },
      },
    ],
  },
  chemistry: {
    rationale:
      "Bonding starts this week, with ionic and covalent bonding. The size and mass of atoms comes back for a quick revision pass, so it stays secure now Topic 1 is done.",
    points: [
      {
        id: "demo-sp-atoms",
        code: "AQA 4.1.1.5",
        title: "Size and mass of atoms",
        topicId: "demo-topic-atomic",
        topicTitle: "Atomic structure and the periodic table",
        lane: "focus",
        work: {
          video: ["Elements, Isotopes & Relative Atomic Mass", DEMO_YT.isotopes],
          quiz: "demo-mcq-atomic",
          task: "demo-hw-atoms",
        },
      },
      {
        id: "demo-sp-ionic",
        code: "AQA 4.2.1.2",
        title: "Ionic bonding",
        topicId: "demo-topic-bonding",
        topicTitle: "Bonding, structure, and the properties of matter",
        lane: "core",
        work: {
          video: ["Properties of Ionic Compounds", DEMO_YT.ionic],
          quiz: "demo-mcq-bonding",
          task: "demo-hw-bonding",
        },
      },
      {
        id: "demo-sp-covalent",
        code: "AQA 4.2.1.4",
        title: "Covalent bonding",
        topicId: "demo-topic-bonding",
        topicTitle: "Bonding, structure, and the properties of matter",
        lane: "core",
        work: {
          video: ["Covalent Bonding", DEMO_YT.covalent],
          quiz: "demo-mcq-covalent",
          task: "demo-hw-covalent",
        },
      },
    ],
  },
  physics: {
    rationale: `Resistance in series and parallel is new this week. I–V graphs were missed last week, so they come back as catch-up. Energy stores returns for revision${
      energyQuiz != null ? `: its quiz was ${energyQuiz}%, so the quiz is worth another go` : ""
    }.`,
    points: [
      {
        id: "demo-sp-circuits",
        code: "OCR P3.2g",
        title: "Linear and non-linear components (I–V graphs)",
        topicId: "demo-topic-electricity",
        topicTitle: "Electricity",
        lane: "core",
        missedWeeksAgo: 1,
        work: {
          video: ["Voltage, Current & Resistance — I–V Graphs", DEMO_YT.ivGraphs],
          quiz: "demo-mcq-electricity",
          task: "demo-hw-electricity",
        },
      },
      {
        id: "demo-sp-series",
        code: "OCR P3.2i",
        title: "Resistance in series and parallel",
        topicId: "demo-topic-electricity",
        topicTitle: "Electricity",
        lane: "core",
        work: {
          video: ["Lamps in Series & Parallel", DEMO_YT.seriesParallel],
          quiz: "demo-mcq-series",
          task: "demo-hw-series",
        },
      },
      {
        id: "demo-sp-energy-stores",
        code: "OCR P7.1b",
        title: "How energy stores change in a system",
        topicId: "demo-topic-energy",
        topicTitle: "Energy",
        lane: "focus",
        work: {
          video: ["Energy Stores: a Worked Example", DEMO_YT.energyStores],
          quiz: "demo-mcq-energy",
          task: "demo-hw-energy",
        },
      },
    ],
  },
};

const quizTitle = (id: string) => DEMO_MCQ_SETS.find((s) => s.id === id)?.title;
const taskTitle = (id: string) => DEMO_HOMEWORK.find((h) => h.id === id)?.title;

/** This week's plan for one subject, built fresh so the dates never go stale. */
export function demoWeek(subject: SubjectV): DemoWeek {
  const weekStart = currentWeekKey();
  const seed = DEMO_WEEK_SEEDS[subject];
  const board = DEMO_ENROLMENTS.find((e) => e.subject === subject)?.board ?? "aqa";

  // The work that exists in the fixtures. A missing id is left off rather than
  // linked to a page with nothing behind it.
  const work = new Map(
    seed.points.map((p) => {
      const quiz = p.work.quiz && quizTitle(p.work.quiz) ? p.work.quiz : undefined;
      const task = p.work.task && taskTitle(p.work.task) ? p.work.task : undefined;
      return [p.id, { quiz, task }];
    }),
  );

  // What Alex has done on each point, read from the quiz attempts and task
  // submissions.
  const coverage = new Map<string, PointCoverage>();
  for (const p of seed.points) {
    const { quiz, task } = work.get(p.id)!;
    const quizScore = quiz ? demoQuizPct(quiz) : null;
    const t = task ? demoTaskState(task) : { handedIn: false, pct: null };
    if (quizScore == null && !t.handedIn) continue;
    const scores = [quizScore, t.pct].filter((n): n is number => n != null);
    coverage.set(p.id, {
      attempted: true,
      quizDone: quizScore != null,
      homeworkDone: t.handedIn,
      quizScore,
      homeworkScore: t.pct,
      bestScore: scores.length ? Math.max(...scores) : null,
    });
  }

  // Ticked off once all of its work is in: the same test the week's "points
  // practised" count uses, so the checklist and the progress card agree.
  const allIn = (id: string) => {
    const { quiz, task } = work.get(id)!;
    const c = coverage.get(id);
    return !!(quiz || task) && (!quiz || !!c?.quizDone) && (!task || !!c?.homeworkDone);
  };

  const points: PlanPoint[] = seed.points.map((p) => ({
    spec_point_id: p.id,
    code: p.code,
    title: p.title,
    description: null,
    topic_id: p.topicId,
    topic_title: p.topicTitle,
    origin: p.lane,
    carried_from: null,
    done_at: allIn(p.id) ? new Date().toISOString() : null,
  }));

  const activity = new Map<string, PointActivity & PointWork>(
    seed.points.map((p) => {
      const { quiz, task } = work.get(p.id)!;
      return [
        p.id,
        {
          hasHomework: !!task,
          hasQuiz: !!quiz,
          videos: p.work.video
            ? [{ id: `${p.id}-video`, title: p.work.video[0], videoUrl: p.work.video[1] }]
            : [],
          homework: task ? [{ id: task, title: taskTitle(task)! }] : [],
          quizzes: quiz ? [{ id: quiz, title: quizTitle(quiz)! }] : [],
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
    roadmap: demoRoadmap(seed.points, weekStart, coverage),
  };
}

/** One row of the road to the exam on the demo planner page. */
export type DemoRoadTopic = {
  /** The topic's code, or "" for the revision block, which has none. */
  code: string;
  title: string;
  /** Weeks from now the topic starts (negative = already under way or done). */
  startsIn: number;
  weeks: number;
  /** How secure the topic is, 0–100 (see `secure`). */
  mastery: number;
};

/** Weeks from this Monday to the first exam week (w/c 10 May 2027). */
export const DEMO_WEEKS_TO_EXAMS = 31;

/** The first teaching week: w/c 7 September 2026. */
const ROAD_START = -4;

/**
 * School holiday weeks, counted from this Monday as the roadmap is: October
 * half-term, Christmas, February half-term and Easter. No block runs through
 * them.
 */
export const DEMO_HOLIDAY_WEEKS: readonly number[] = [3, 11, 12, 19, 25, 26];

/**
 * The programme behind "Missed work returning", and nothing more. The lane
 * shows a plan point that this week's catch-up carries; the info button reads
 * the week it was first planned for. Every other part of the programme is left
 * empty, so no other lane changes.
 */
function demoRoadmap(
  seeds: PointSeed[],
  weekStart: string,
  coverage: Map<string, PointCoverage>,
): RoadmapResult {
  const monday = weekKeyToDate(weekStart);
  const missed: BacklogPoint[] = seeds
    .filter((p) => p.missedWeeksAgo)
    .map((p) => ({
      specPointId: p.id,
      topicId: p.topicId,
      topicTitle: p.topicTitle,
      code: p.code,
      title: p.title,
      weight: 1,
      plannedWeek: toDateKey(addWeeks(monday, -p.missedWeeksAgo!)),
    }));
  return {
    bands: [],
    baselineBands: [],
    changes: [],
    needsAck: false,
    programStart: toDateKey(addWeeks(monday, ROAD_START)),
    examDate: toDateKey(addWeeks(monday, DEMO_WEEKS_TO_EXAMS)),
    coveredTopicIds: [],
    completedPointIds: [],
    progress: [],
    reviewBacklog: [],
    reviewsWaiting: [],
    inadmissible: [],
    // Still owed: a mark is delivery, as in the live ledger. A point this
    // week's catch-up carries stays in its lane once it is started.
    backlog: missed.filter((b) => coverage.get(b.specPointId)?.bestScore == null),
    // This week already carries every missed point, so none is left to offer.
    backlogByTopic: [],
    catchUpSchedule: {
      weeks: missed.length ? { [weekStart]: missed } : {},
      assignedIds: missed.map((b) => b.specPointId),
      held: [],
    },
    unscheduledTopicTitles: [],
    focusLoad: { spine: 1, overloaded: false },
    overrides: [],
  };
}

/**
 * How secure a topic is, 0–100: the best mark on each of its spec points in the
 * demo curriculum, averaged, with an unmarked point counting as 0. Read from the
 * quiz attempts and task submissions, so it moves with them. A topic the demo
 * curriculum doesn't hold has nothing marked.
 */
function secure(subject: SubjectV, title: string): number {
  const id = DEMO_CURRICULUM_TOPICS[subject]?.find((t) => t.title === title)?.id;
  const points = id ? (DEMO_CURRICULUM_SPEC_POINTS[id] ?? []) : [];
  if (!points.length) return 0;
  const best = (pointId: string) => {
    const content = DEMO_CURRICULUM_CONTENT[pointId];
    const marks = [
      ...(content?.mcqSets ?? []).map((s) => demoQuizPct(s.id)),
      ...(content?.resources ?? [])
        .filter((r) => r.kind === "homework")
        .map((r) => demoTaskState(r.id).pct),
    ].filter((n): n is number => n != null);
    return marks.length ? Math.max(...marks) : 0;
  };
  return Math.round(points.reduce((sum, p) => sum + best(p.id), 0) / points.length);
}

const topic = (code: string, title: string, startsIn: number, weeks: number) => ({
  code,
  title,
  startsIn,
  weeks,
});

/** A subject's topics with how secure each is, then revision and mocks up to the exams. */
const road = (subject: SubjectV, topics: ReturnType<typeof topic>[]): DemoRoadTopic[] => [
  ...topics.map((t) => ({ ...t, mastery: secure(subject, t.title) })),
  { code: "", title: "Revision & mocks", startsIn: 27, weeks: 4, mastery: 0 },
];

/**
 * The road to the exam, one row per topic. Weeks are counted from this Monday
 * so the current topic is always "this week".
 *
 * Laid out from the week of 5 October 2026: teaching from early September,
 * nothing new over the school holidays, and revision and mocks before the
 * exams in May. Each subject lists every topic of its board's spec: Edexcel
 * Biology's 9, AQA Chemistry's 10 and OCR Physics' 8.
 *
 * The order is the tutor's, not the spec's. Topics that hold Alex's marked work
 * come first, then the topic under way, then the rest in spec order. Biology
 * opened with photosynthesis, respiration and mitosis (Topics 6, 8 and 2), which
 * is why they already have marks while Topic 1 is under way. Physics took
 * Energy (Topic 7) before Electricity (Topic 3), as many schools do.
 */
export const DEMO_ROADMAP: Record<SubjectV, DemoRoadTopic[]> = {
  biology: road("biology", [
    topic("Topic 6", "Plant structures and their functions", ROAD_START, 1),
    topic("Topic 8", "Exchange and transport in animals", -3, 1),
    topic("Topic 2", "Cells and control", -2, 1),
    topic("Topic 1", "Key concepts in biology", -1, 4),
    topic("Topic 3", "Genetics", 4, 4),
    topic("Topic 4", "Natural selection and genetic modification", 8, 3),
    topic("Topic 5", "Health, disease and the development of medicines", 13, 6),
    topic("Topic 7", "Animal coordination, control and homeostasis", 20, 3),
    topic("Topic 9", "Ecosystems and material cycles", 23, 2),
  ]),
  chemistry: road("chemistry", [
    topic("Topic 1", "Atomic structure and the periodic table", ROAD_START, 4),
    topic("Topic 2", "Bonding, structure, and the properties of matter", 0, 3),
    topic("Topic 3", "Quantitative chemistry", 4, 4),
    topic("Topic 4", "Chemical changes", 8, 3),
    topic("Topic 5", "Energy changes", 13, 2),
    topic("Topic 6", "The rate and extent of chemical change", 15, 2),
    topic("Topic 7", "Organic chemistry", 17, 2),
    topic("Topic 8", "Chemical analysis", 20, 2),
    topic("Topic 9", "Chemistry of the atmosphere", 22, 1),
    topic("Topic 10", "Using resources", 23, 2),
  ]),
  physics: road("physics", [
    topic("Topic 7", "Energy", ROAD_START, 3),
    // Under way since last week. Its first point, missed then, is this week's catch-up.
    topic("Topic 3", "Electricity", -1, 4),
    topic("Topic 1", "Matter", 4, 3),
    topic("Topic 2", "Forces", 7, 4),
    topic("Topic 4", "Magnetism and magnetic fields", 13, 3),
    topic("Topic 5", "Waves in matter", 16, 3),
    topic("Topic 6", "Radioactivity", 20, 3),
    topic("Topic 8", "Global challenges", 23, 2),
  ]),
};
