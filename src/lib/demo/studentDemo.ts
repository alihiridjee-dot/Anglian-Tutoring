import { isDemoMode, getDemoRole } from "@/lib/auth/session";
import type { SubjectAnalytics } from "@/lib/analytics";
import type { Topic, SpecPoint, Resource, McqSet } from "@/lib/curriculum/types";

/**
 * Demo-student isolation layer.
 *
 * The public "student demo" is a pure, self-contained UI showcase. It must NEVER
 * read or write real content (curriculum, homework, submissions, MCQs, etc.) —
 * everything it displays comes from the hardcoded fixtures below. This keeps the
 * demo visually rich and "sellable" while fully decoupling it from whatever a
 * tutor uploads, past or future. Real feature testing uses the dedicated test
 * accounts instead.
 *
 * Detection is a UI concern only (local flags set at demo sign-in); real data
 * isolation for genuine accounts is still enforced by RLS.
 */
export function isDemoStudent(): boolean {
  return isDemoMode() && getDemoRole() === "student";
}

export const DEMO_STUDENT_NAME = "Alex";
export const DEMO_PARENT_NAME = "Sarah (Parent)";
export const DEMO_SUBJECTS = ["biology", "chemistry", "physics"] as const;

/** The showcase student's shared exam level. */
export const DEMO_LEVEL = "gcse" as const;

/**
 * Per-subject enrolment for the showcase — deliberately mixes boards so the
 * demo shows off that a student can sit each subject with a different exam
 * board at the same level.
 */
export const DEMO_ENROLMENTS = [
  { subject: "biology", board: "edexcel" },
  { subject: "chemistry", board: "aqa" },
  { subject: "physics", board: "ocr" },
] as const;

/** Impressive-but-believable progress profile shown across the demo. */
export const DEMO_ANALYTICS: SubjectAnalytics[] = [
  {
    subject: "biology",
    mcqAttempts: 14,
    mcqAverage: 91,
    hwGraded: 8,
    hwAverage: 88,
    predictedGrade: 9,
  },
  {
    subject: "chemistry",
    mcqAttempts: 11,
    mcqAverage: 83,
    hwGraded: 6,
    hwAverage: 79,
    predictedGrade: 8,
  },
  {
    subject: "physics",
    mcqAttempts: 9,
    mcqAverage: 76,
    hwGraded: 5,
    hwAverage: 72,
    predictedGrade: 7,
  },
];

export type DemoHomework = {
  id: string;
  title: string;
  instructions: string | null;
  subject: string;
  due_at: string | null;
  created_at: string;
  origin: "tutor" | "generated";
};

export type DemoSubmission = {
  id: string;
  resource_id: string;
  student_id: string;
  notes: string | null;
  submitted_at: string;
  grade: string | null;
  score_pct: number | null;
  feedback: string | null;
  graded_at: string | null;
  /** Always null in the demo: acknowledging would write to the real DB. */
  acknowledged_at: string | null;
  /** Set on the one piece that is still being marked, so the demo shows that state. */
  release_at: string | null;
};

/** A question on a demo sheet. Matches the shape `useHomeworkQuestions` returns. */
export type DemoQuestion = {
  id: string;
  resource_id: string;
  position: number;
  prompt: string;
  marks: number;
  answer_type: "short" | "long" | "numeric";
  mark_scheme: string | null;
  spec_point_id: string | null;
};

/** A demo answer. Matches the shape `useHomeworkAnswers` returns. */
export type DemoAnswer = {
  id: string;
  submission_id: string;
  question_id: string;
  answer_text: string | null;
  awarded_marks: number | null;
  feedback: string | null;
};

// Dates are generated relative to "now" so the demo never looks stale.
const daysFromNow = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

// Every question is answerable in typed prose. That is not a stylistic choice:
// homework is answered in a textarea on the page, so a fixture that told a
// student to draw a graph would be showcasing something the product cannot do.
export const DEMO_HOMEWORK: DemoHomework[] = [
  {
    id: "demo-hw-photosynthesis",
    title: "Photosynthesis: Limiting Factors",
    instructions:
      "Think back to the pondweed practical. Describe in words what the graph does and explain why — you don't need to draw anything.",
    subject: "biology",
    due_at: daysFromNow(-6),
    created_at: daysFromNow(-13),
    origin: "tutor",
  },
  {
    id: "demo-hw-mitosis",
    title: "Cell Division & the Cell Cycle",
    instructions: "Describe the stages in order, then the extended question on why it matters.",
    subject: "biology",
    due_at: daysFromNow(-2),
    created_at: daysFromNow(-9),
    origin: "tutor",
  },
  {
    id: "demo-hw-rates",
    title: "Rates of Reaction — Required Practical",
    instructions:
      "Sodium thiosulfate and hydrochloric acid. Describe the trend, then evaluate the method.",
    subject: "chemistry",
    due_at: daysFromNow(1),
    created_at: daysFromNow(-5),
    origin: "tutor",
  },
  {
    id: "demo-hw-electricity",
    title: "Electricity: I–V Characteristics",
    instructions:
      "Describe the shape of the I–V graph for each component and explain the physics behind it.",
    subject: "physics",
    due_at: daysFromNow(4),
    created_at: daysFromNow(-1),
    origin: "tutor",
  },
  // No due date, so this lands in the practice section — which is where the
  // planner's per-spec-point sheets live for a real student.
  {
    id: "demo-hw-osmosis",
    title: "4.1.3 Osmosis",
    instructions: null,
    subject: "biology",
    due_at: null,
    created_at: daysFromNow(-4),
    origin: "generated",
  },
];

/** Submissions keyed by homework id. Two marked, one still being marked, two outstanding. */
export const DEMO_SUBMISSIONS: Record<string, DemoSubmission> = {
  "demo-hw-photosynthesis": {
    id: "demo-sub-1",
    resource_id: "demo-hw-photosynthesis",
    student_id: "demo",
    notes: "I wasn't sure how to word the bit about the plateau.",
    submitted_at: daysFromNow(-7),
    grade: "8",
    score_pct: 88,
    feedback:
      "A confident answer with the inverse-square relationship handled well. To push to a 9, be explicit about why the rate plateaus once CO₂ becomes the limiting factor.",
    graded_at: daysFromNow(-5),
    acknowledged_at: null,
    release_at: null,
  },
  "demo-hw-mitosis": {
    id: "demo-sub-2",
    resource_id: "demo-hw-mitosis",
    student_id: "demo",
    notes: null,
    submitted_at: daysFromNow(-3),
    grade: "9",
    score_pct: 92,
    feedback:
      "Superb — every stage in the right order and a well-structured extended answer on the cell cycle. Exam-ready on this topic.",
    graded_at: daysFromNow(-1),
    acknowledged_at: null,
    release_at: null,
  },
  "demo-hw-rates": {
    id: "demo-sub-3",
    resource_id: "demo-hw-rates",
    student_id: "demo",
    notes: "Not sure my evaluation section is detailed enough — would appreciate feedback there.",
    submitted_at: daysFromNow(-1),
    grade: null,
    score_pct: null,
    feedback: null,
    graded_at: null,
    acknowledged_at: null,
    // Still inside its review window, which is the state the page explains
    // rather than leaving blank.
    release_at: daysFromNow(0.5),
  },
  // demo-hw-electricity and demo-hw-osmosis intentionally have no submission —
  // one outstanding "due" task and one untouched practice sheet.
};

/**
 * The questions on each demo sheet, keyed by homework id.
 *
 * The fixtures used to stop at the brief, which left the showcase demonstrating
 * a homework page with no homework on it — the one screen a prospective parent
 * most wants to see working.
 */
export const DEMO_QUESTIONS: Record<string, DemoQuestion[]> = {
  "demo-hw-photosynthesis": [
    {
      id: "demo-q-ps-1",
      resource_id: "demo-hw-photosynthesis",
      position: 0,
      prompt:
        "Describe what happens to the rate of photosynthesis as the lamp is moved further from the pondweed.",
      marks: 2,
      answer_type: "short",
      mark_scheme: "Rate decreases (1). Light intensity falls with distance (1).",
      spec_point_id: null,
    },
    {
      id: "demo-q-ps-2",
      resource_id: "demo-hw-photosynthesis",
      position: 1,
      prompt:
        "Explain why the rate stops increasing at high light intensity, even though the lamp is getting brighter.",
      marks: 4,
      answer_type: "long",
      mark_scheme:
        "Light is no longer the limiting factor (1). Another factor limits the rate (1). Named: CO₂ concentration or temperature (1). Rate is capped by whichever factor is in shortest supply (1).",
      spec_point_id: null,
    },
  ],
  "demo-hw-mitosis": [
    {
      id: "demo-q-mi-1",
      resource_id: "demo-hw-mitosis",
      position: 0,
      prompt: "Name the stages of the cell cycle in order.",
      marks: 3,
      answer_type: "short",
      mark_scheme: "Interphase (1), mitosis (1), cytokinesis (1). Correct order required.",
      spec_point_id: null,
    },
    {
      id: "demo-q-mi-2",
      resource_id: "demo-hw-mitosis",
      position: 1,
      prompt: "Explain why the DNA must be copied before a cell divides.",
      marks: 4,
      answer_type: "long",
      mark_scheme:
        "Each daughter cell needs a full copy (1). Otherwise cells would lose genetic information (1). Copies are identical (1). Needed for growth and repair (1).",
      spec_point_id: null,
    },
  ],
  "demo-hw-rates": [
    {
      id: "demo-q-ra-1",
      resource_id: "demo-hw-rates",
      position: 0,
      prompt:
        "Describe how the time for the cross to disappear changes as the concentration of sodium thiosulfate increases.",
      marks: 2,
      answer_type: "short",
      mark_scheme: "Time decreases (1). Rate of reaction increases (1).",
      spec_point_id: null,
    },
    {
      id: "demo-q-ra-2",
      resource_id: "demo-hw-rates",
      position: 1,
      prompt: "Evaluate the method. Give one weakness and how you would improve it.",
      marks: 4,
      answer_type: "long",
      mark_scheme:
        "Judging the disappearing cross is subjective (1). Different people judge it differently (1). Improvement: use a light sensor or data logger (1). Gives a consistent end point (1).",
      spec_point_id: null,
    },
  ],
  "demo-hw-electricity": [
    {
      id: "demo-q-el-1",
      resource_id: "demo-hw-electricity",
      position: 0,
      prompt: "Describe the shape of the I–V graph for a fixed resistor at constant temperature.",
      marks: 2,
      answer_type: "short",
      mark_scheme: "Straight line (1) through the origin (1).",
      spec_point_id: null,
    },
    {
      id: "demo-q-el-2",
      resource_id: "demo-hw-electricity",
      position: 1,
      prompt: "Explain why the graph for a filament lamp curves.",
      marks: 3,
      answer_type: "long",
      mark_scheme:
        "Current heats the filament (1). Resistance increases with temperature (1). So current rises less steeply at higher voltage (1).",
      spec_point_id: null,
    },
  ],
  "demo-hw-osmosis": [
    {
      id: "demo-q-os-1",
      resource_id: "demo-hw-osmosis",
      position: 0,
      prompt: "Define osmosis.",
      marks: 3,
      answer_type: "short",
      mark_scheme:
        "Movement of water (1) from a dilute to a concentrated solution (1) through a partially permeable membrane (1).",
      spec_point_id: null,
    },
    {
      id: "demo-q-os-2",
      resource_id: "demo-hw-osmosis",
      position: 1,
      prompt: "Explain what happens to a piece of potato left in pure water.",
      marks: 3,
      answer_type: "long",
      mark_scheme:
        "Water moves into the cells by osmosis (1). Cells become turgid (1). The potato gains mass / increases in length (1).",
      spec_point_id: null,
    },
  ],
};

/** The demo student's answers, keyed by question id, with marks where marked. */
export const DEMO_ANSWERS: Record<string, DemoAnswer> = {
  "demo-q-ps-1": {
    id: "demo-a-ps-1",
    submission_id: "demo-sub-1",
    question_id: "demo-q-ps-1",
    answer_text:
      "The rate goes down as the lamp gets further away, because the light reaching the pondweed is weaker.",
    awarded_marks: 2,
    feedback: "Both marks — the link to light intensity is exactly what was wanted.",
  },
  "demo-q-ps-2": {
    id: "demo-a-ps-2",
    submission_id: "demo-sub-1",
    question_id: "demo-q-ps-2",
    answer_text:
      "Because light isn't the thing holding it back any more. Something else becomes the limiting factor, like carbon dioxide, so making the lamp brighter doesn't help.",
    awarded_marks: 3,
    feedback:
      "Three of four. You named CO₂ but didn't say the rate is capped by whichever factor is in shortest supply.",
  },
  "demo-q-mi-1": {
    id: "demo-a-mi-1",
    submission_id: "demo-sub-2",
    question_id: "demo-q-mi-1",
    answer_text: "Interphase, then mitosis, then cytokinesis.",
    awarded_marks: 3,
    feedback: "All three, in the right order.",
  },
  "demo-q-mi-2": {
    id: "demo-a-mi-2",
    submission_id: "demo-sub-2",
    question_id: "demo-q-mi-2",
    answer_text:
      "So each new cell gets a complete copy of the DNA. If it wasn't copied first the two cells would end up with half each and lose genetic information. The copies are identical, which is what you need for growth and repair.",
    awarded_marks: 4,
    feedback: "Full marks — all four points, clearly linked.",
  },
  "demo-q-ra-1": {
    id: "demo-a-ra-1",
    submission_id: "demo-sub-3",
    question_id: "demo-q-ra-1",
    answer_text: "The time gets shorter as the concentration goes up, so the rate is faster.",
    awarded_marks: null,
    feedback: null,
  },
  "demo-q-ra-2": {
    id: "demo-a-ra-2",
    submission_id: "demo-sub-3",
    question_id: "demo-q-ra-2",
    answer_text:
      "Watching for the cross to disappear is a judgement call and people see it at different points. A light sensor would be more reliable.",
    awarded_marks: null,
    feedback: null,
  },
};

// ---------------------------------------------------------------------------
// Videos, live sessions, MCQs — all fixture content for the demo.
// ---------------------------------------------------------------------------

export type DemoVideo = {
  id: string;
  title: string;
  description: string | null;
  subject: string;
  board: string;
  level: string;
  video_url: string;
};

/**
 * Real, public GCSE revision videos — the same ones tutors have attached in the
 * live library. They used to point at `watch?v=demo`, which has no thumbnail and
 * no player behind it, so every video tile in the showcase was a grey box.
 * These are only URLs: nothing is read from the library at runtime.
 */
const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const DEMO_YT = {
  photosynthesis: yt("6sLrh-SDv_Y"),
  photosynthesisPractical: yt("id0aO_OdFwA"),
  osmosis: yt("B0cH91joZwA"),
  transport: yt("fUEnfb9VpgE"),
  cells: yt("qHkUOlC8Nbo"),
  mitosis: yt("9ttuZxrJZpk"),
  digestion: yt("e1RUivE3H1k"),
  pathogens: yt("-30_21Juyek"),
  respiration: yt("dDkxJzLepFI"),
  collision: yt("JK7yPzO9POU"),
  ratesPractical: yt("Gl6LVl7oAlU"),
  isotopes: yt("-FBk8cNvJds"),
  ionic: yt("3hUwVYOue5s"),
  ivGraphs: yt("BbizKa6eywo"),
  seriesParallel: yt("CmOH3HjSQAY"),
  energyStores: yt("2HJ2y5US7VI"),
  covalent: yt("7IkYm7ZgiAw"),
} as const;

export const DEMO_VIDEOS: DemoVideo[] = [
  {
    id: "demo-vid-1",
    title: "Photosynthesis: Limiting Factors",
    description:
      "Light intensity, CO₂ and temperature — and how to read the limiting-factor graphs.",
    subject: "biology",
    board: "edexcel",
    level: "gcse",
    video_url: DEMO_YT.photosynthesis,
  },
  {
    id: "demo-vid-2",
    title: "Required Practical: Osmosis in Potato Cells",
    description: "Step-by-step method, results table, and how to plot percentage change in mass.",
    subject: "biology",
    board: "edexcel",
    level: "gcse",
    video_url: DEMO_YT.osmosis,
  },
  {
    id: "demo-vid-3",
    title: "Rates of Reaction — Collision Theory",
    description: "How concentration, temperature, surface area and catalysts affect rate.",
    subject: "chemistry",
    board: "aqa",
    level: "gcse",
    video_url: DEMO_YT.collision,
  },
  {
    id: "demo-vid-4",
    title: "Electricity: Series & Parallel Circuits",
    description: "Current, potential difference and resistance rules with worked examples.",
    subject: "physics",
    board: "ocr",
    level: "gcse",
    video_url: DEMO_YT.seriesParallel,
  },
  {
    id: "demo-vid-5",
    title: "Ionic Bonding & the Properties of Ionic Compounds",
    description: "Why ionic compounds form giant lattices, and why they melt so high.",
    subject: "chemistry",
    board: "aqa",
    level: "gcse",
    video_url: DEMO_YT.ionic,
  },
  {
    id: "demo-vid-6",
    title: "Diffusion, Osmosis & Active Transport",
    description: "The three ways substances cross a membrane, side by side.",
    subject: "biology",
    board: "edexcel",
    level: "gcse",
    video_url: DEMO_YT.transport,
  },
];

export type DemoLive = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  subject: string;
  board: string;
  level: string;
  starts_at: string;
  join_url: string | null;
};

export const DEMO_LIVE: DemoLive[] = [
  {
    id: "demo-live-1",
    kind: "live_session",
    title: "Biology: Exam Technique for 6-Mark Questions",
    description: "Live worked examples on structuring extended-response answers.",
    subject: "biology",
    board: "edexcel",
    level: "gcse",
    starts_at: daysFromNow(2),
    join_url: "https://zoom.us/j/8500000001",
  },
  {
    id: "demo-live-2",
    kind: "live_session",
    title: "Chemistry: Mastering Mole Calculations",
    description: "From moles to concentrations and titration maths.",
    subject: "chemistry",
    board: "aqa",
    level: "gcse",
    starts_at: daysFromNow(5),
    join_url: "https://zoom.us/j/8500000002",
  },
  {
    id: "demo-live-3",
    kind: "live_session",
    title: "Physics: Forces & Motion Recap",
    description: "Recorded — recap of speed, velocity and acceleration graphs.",
    subject: "physics",
    board: "ocr",
    level: "gcse",
    starts_at: daysFromNow(-3),
    join_url: null,
  },
];

export type DemoMcqSet = {
  id: string;
  title: string;
  published: boolean;
  created_at: string;
  board: string;
  level: string;
  subject: string;
  topic: string;
  /** Curriculum order of the topic, so the archive files topics as the spec does. */
  topicSort: number;
  /** The spec point code the set is written for. */
  specPoint: string;
  /** On the demo student's plan this week, rather than filed under Past MCQs. */
  thisWeek: boolean;
};

/**
 * The demo's quizzes. Every set is fixture content — there is no generation,
 * no read of `mcq_sets`, and no attempt is ever written. A real student's quizzes
 * are generated per spec point by `ensureMcqForPoints`; nothing here reaches it.
 */
export const DEMO_MCQ_SETS: DemoMcqSet[] = [
  // This week's work — one per subject, matching the demo planner.
  {
    id: "demo-mcq-transport",
    title: "Transport in Cells — Diffusion, Osmosis & Active Transport",
    published: true,
    created_at: daysFromNow(-1),
    board: "edexcel",
    level: "gcse",
    subject: "biology",
    topic: "Cell Biology",
    topicSort: 1,
    specPoint: "4.1.3",
    thisWeek: true,
  },
  {
    id: "demo-mcq-bonding",
    title: "Ionic Bonding",
    published: true,
    created_at: daysFromNow(-1),
    board: "aqa",
    level: "gcse",
    subject: "chemistry",
    topic: "Bonding, Structure & Properties",
    topicSort: 2,
    specPoint: "5.2.1",
    thisWeek: true,
  },
  {
    id: "demo-mcq-electricity",
    title: "Circuits & I–V Characteristics",
    published: true,
    created_at: daysFromNow(-1),
    board: "ocr",
    level: "gcse",
    subject: "physics",
    topic: "Electricity",
    topicSort: 2,
    specPoint: "6.2.1",
    thisWeek: true,
  },
  // Earlier weeks — already attempted, so the archive shows scores.
  {
    id: "demo-mcq-cells",
    title: "Cell Structure",
    published: true,
    created_at: daysFromNow(-16),
    board: "edexcel",
    level: "gcse",
    subject: "biology",
    topic: "Cell Biology",
    topicSort: 1,
    specPoint: "4.1.1",
    thisWeek: false,
  },
  {
    id: "demo-mcq-mitosis",
    title: "Cell Division & Mitosis",
    published: true,
    created_at: daysFromNow(-9),
    board: "edexcel",
    level: "gcse",
    subject: "biology",
    topic: "Cell Biology",
    topicSort: 1,
    specPoint: "4.1.2",
    thisWeek: false,
  },
  {
    id: "demo-mcq-bioenergetics",
    title: "Photosynthesis & Limiting Factors",
    published: true,
    created_at: daysFromNow(-23),
    board: "edexcel",
    level: "gcse",
    subject: "biology",
    topic: "Bioenergetics",
    topicSort: 4,
    specPoint: "4.4.1",
    thisWeek: false,
  },
  {
    id: "demo-mcq-atomic",
    title: "Atoms, Isotopes & Relative Atomic Mass",
    published: true,
    created_at: daysFromNow(-12),
    board: "aqa",
    level: "gcse",
    subject: "chemistry",
    topic: "Atomic Structure & the Periodic Table",
    topicSort: 1,
    specPoint: "5.1.1",
    thisWeek: false,
  },
  {
    id: "demo-mcq-energy",
    title: "Energy Stores & Transfers",
    published: true,
    created_at: daysFromNow(-12),
    board: "ocr",
    level: "gcse",
    subject: "physics",
    topic: "Energy",
    topicSort: 1,
    specPoint: "6.1.1",
    thisWeek: false,
  },
];

/**
 * The demo student's best score on each set they've taken, out of the set's
 * length. This week's sets are left untaken so a visitor can try one.
 */
export const DEMO_MCQ_ATTEMPTS: Record<string, { score: number; total: number }> = {
  "demo-mcq-cells": { score: 5, total: 5 },
  "demo-mcq-mitosis": { score: 4, total: 5 },
  "demo-mcq-bioenergetics": { score: 4, total: 5 },
  "demo-mcq-atomic": { score: 4, total: 5 },
  "demo-mcq-energy": { score: 3, total: 5 },
};

export type DemoMcqQuestion = {
  id: string;
  position: number;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
};

/** Builds a question list with positions, so fixtures stay short to read. */
const qs = (
  prefix: string,
  items: Array<[question: string, options: string[], correct: number, explanation: string]>,
): DemoMcqQuestion[] =>
  items.map(([question, options, correct_index, explanation], position) => ({
    id: `${prefix}-${position + 1}`,
    position,
    question,
    options,
    correct_index,
    explanation,
  }));

const mcqSet = (id: string, description: string, questions: DemoMcqQuestion[]) => {
  const meta = DEMO_MCQ_SETS.find((s) => s.id === id)!;
  return { set: { id, title: meta.title, description, published: true }, questions };
};

export const DEMO_MCQ: Record<
  string,
  {
    set: { id: string; title: string; description: string | null; published: boolean };
    questions: DemoMcqQuestion[];
  }
> = {
  "demo-mcq-transport": mcqSet(
    "demo-mcq-transport",
    "How substances move in and out of cells. Five questions, marked the moment you submit.",
    qs("dq-tr", [
      [
        "Diffusion is the net movement of particles…",
        [
          "from low to high concentration, using energy",
          "from high to low concentration",
          "only through a partially permeable membrane",
          "only in plant cells",
        ],
        1,
        "Diffusion is passive: particles spread from high to low concentration, down the gradient, with no energy needed.",
      ],
      [
        "Osmosis is the diffusion of which substance?",
        ["Glucose", "Oxygen", "Water", "Mineral ions"],
        2,
        "Osmosis is the movement of water from a dilute to a more concentrated solution through a partially permeable membrane.",
      ],
      [
        "A potato chip is left in concentrated salt solution. What happens to its mass?",
        [
          "It increases, because water moves in",
          "It decreases, because water moves out",
          "It stays the same",
          "It increases, because salt moves in",
        ],
        1,
        "The solution outside is more concentrated, so water leaves the potato cells by osmosis and the chip loses mass.",
      ],
      [
        "Which process can move substances against a concentration gradient?",
        ["Diffusion", "Osmosis", "Active transport", "Evaporation"],
        2,
        "Active transport uses energy from respiration to move substances from low to high concentration.",
      ],
      [
        "Root hair cells absorb mineral ions by active transport. Why can't they use diffusion?",
        [
          "Mineral ions are too large to diffuse",
          "The concentration of ions is lower in the soil than in the root",
          "Diffusion only works for gases",
          "Root hair cells have no cell membrane",
        ],
        1,
        "The soil holds fewer ions than the root cell, so ions must be moved up the gradient — which needs energy.",
      ],
    ]),
  ),
  "demo-mcq-bonding": mcqSet(
    "demo-mcq-bonding",
    "How metals and non-metals swap electrons to form ions and giant lattices.",
    qs("dq-bo", [
      [
        "Ionic bonding happens between…",
        ["two non-metals", "a metal and a non-metal", "two metals", "noble gases only"],
        1,
        "Metal atoms lose electrons and non-metal atoms gain them, forming oppositely charged ions.",
      ],
      [
        "What charge does a sodium ion carry?",
        ["+1", "−1", "+2", "0"],
        0,
        "Sodium is in Group 1, so it loses its single outer electron to form Na⁺.",
      ],
      [
        "What is the formula of magnesium oxide?",
        ["Mg₂O", "MgO₂", "MgO", "Mg₂O₃"],
        2,
        "Mg²⁺ and O²⁻ carry equal and opposite charges, so they combine one to one.",
      ],
      [
        "Why do ionic compounds have high melting points?",
        [
          "Their molecules are very large",
          "Strong electrostatic forces act in all directions in the lattice",
          "They contain delocalised electrons",
          "Their covalent bonds are hard to break",
        ],
        1,
        "A giant ionic lattice is held by strong attraction between oppositely charged ions, which takes a lot of energy to overcome.",
      ],
      [
        "When can an ionic compound conduct electricity?",
        ["Only as a solid", "Never", "When melted or dissolved in water", "Only when cold"],
        2,
        "Melted or dissolved, the ions are free to move and carry charge. In a solid they are held in place.",
      ],
    ]),
  ),
  "demo-mcq-electricity": mcqSet(
    "demo-mcq-electricity",
    "Current, potential difference, resistance and how components behave.",
    qs("dq-el", [
      [
        "Which equation links potential difference, current and resistance?",
        ["V = I ÷ R", "V = I × R", "V = R ÷ I", "V = I + R"],
        1,
        "Potential difference (V) = current (A) × resistance (Ω).",
      ],
      [
        "A 12 Ω resistor has a current of 0.5 A through it. What is the potential difference?",
        ["24 V", "6 V", "12.5 V", "0.04 V"],
        1,
        "V = I × R = 0.5 × 12 = 6 V.",
      ],
      [
        "What shape is the I–V graph for a fixed resistor at constant temperature?",
        [
          "A curve that flattens off",
          "A straight line through the origin",
          "A horizontal line",
          "Zero until a threshold, then steep",
        ],
        1,
        "Current is directly proportional to potential difference, so the line is straight and passes through the origin.",
      ],
      [
        "Why does the I–V graph for a filament lamp curve?",
        [
          "Its resistance falls as it gets hotter",
          "Its resistance rises as it gets hotter",
          "It only lets current flow one way",
          "Its resistance depends on light level",
        ],
        1,
        "As the filament heats up, its ions vibrate more, so resistance increases and current rises less steeply.",
      ],
      [
        "In a series circuit, the current is…",
        [
          "shared between the components",
          "the same everywhere",
          "largest through the biggest resistor",
          "zero at the cell",
        ],
        1,
        "There is only one path in a series circuit, so the same current flows through every component.",
      ],
    ]),
  ),
  "demo-mcq-cells": mcqSet(
    "demo-mcq-cells",
    "Animal, plant and bacterial cells, and what each part does.",
    qs("dq-ce", [
      [
        "Which organelle is the site of aerobic respiration?",
        ["Nucleus", "Mitochondria", "Ribosome", "Chloroplast"],
        1,
        "Mitochondria carry out aerobic respiration, releasing energy from glucose.",
      ],
      [
        "What structure do plant cells have that animal cells do not?",
        ["Cell membrane", "Cytoplasm", "Cell wall", "Mitochondria"],
        2,
        "Plant cells have a cellulose cell wall for support; animal cells do not.",
      ],
      [
        "Prokaryotic cells differ from eukaryotic cells because they have no…",
        ["Cytoplasm", "Cell membrane", "Genetic material", "True nucleus"],
        3,
        "Prokaryotes have DNA free in the cytoplasm as a single loop, not enclosed in a nucleus.",
      ],
      [
        "Where are proteins made in a cell?",
        ["Ribosomes", "Vacuole", "Cell wall", "Nucleus"],
        0,
        "Ribosomes are the site of protein synthesis.",
      ],
      [
        "What is the function of chloroplasts?",
        [
          "Controlling the cell's activities",
          "Absorbing light for photosynthesis",
          "Storing cell sap",
          "Releasing energy",
        ],
        1,
        "Chloroplasts contain chlorophyll, which absorbs light energy for photosynthesis.",
      ],
    ]),
  ),
  "demo-mcq-mitosis": mcqSet(
    "demo-mcq-mitosis",
    "The cell cycle, mitosis and stem cells.",
    qs("dq-mi", [
      [
        "What happens during interphase?",
        [
          "The cell splits in two",
          "DNA is copied and the cell grows",
          "Chromosomes line up at the centre",
          "The nucleus disappears for good",
        ],
        1,
        "Before mitosis the cell grows, makes more organelles and copies its DNA.",
      ],
      [
        "How many daughter cells does mitosis produce?",
        ["One", "Two", "Four", "Eight"],
        1,
        "Mitosis produces two genetically identical daughter cells.",
      ],
      [
        "Mitosis is needed for…",
        [
          "making gametes",
          "growth and repair",
          "creating variation",
          "halving the chromosome number",
        ],
        1,
        "Mitosis makes identical cells for growth, repair and asexual reproduction.",
      ],
      [
        "What is the final stage of the cell cycle, when the cytoplasm divides?",
        ["Interphase", "Mitosis", "Cytokinesis", "Meiosis"],
        2,
        "In cytokinesis the cytoplasm and cell membrane divide to form two cells.",
      ],
      [
        "Where are stem cells found in plants?",
        ["Leaves", "Meristems", "Xylem", "Root hair cells"],
        1,
        "Meristem tissue at the tips of roots and shoots contains stem cells.",
      ],
    ]),
  ),
  "demo-mcq-bioenergetics": mcqSet(
    "demo-mcq-bioenergetics",
    "Photosynthesis, limiting factors and the inverse-square law.",
    qs("dq-bi", [
      [
        "Which is a product of photosynthesis?",
        ["Carbon dioxide", "Oxygen", "Nitrogen", "Methane"],
        1,
        "Photosynthesis produces glucose and oxygen from carbon dioxide and water.",
      ],
      [
        "Which of these is NOT a limiting factor of photosynthesis?",
        ["Light intensity", "CO₂ concentration", "Temperature", "Soil colour"],
        3,
        "Light, CO₂ and temperature limit the rate; soil colour does not.",
      ],
      [
        "Photosynthesis is described as endothermic because…",
        [
          "it releases energy",
          "it takes in energy from the environment",
          "it happens only at night",
          "it produces heat",
        ],
        1,
        "Energy is transferred from the environment (light) to the chloroplasts.",
      ],
      [
        "If the distance from a lamp doubles, light intensity…",
        ["doubles", "halves", "falls to a quarter", "stays the same"],
        2,
        "Light intensity follows the inverse-square law: 1 ÷ distance².",
      ],
      [
        "Where in the cell does photosynthesis happen?",
        ["Mitochondria", "Nucleus", "Chloroplasts", "Ribosomes"],
        2,
        "Chloroplasts contain the chlorophyll that absorbs light.",
      ],
    ]),
  ),
  "demo-mcq-atomic": mcqSet(
    "demo-mcq-atomic",
    "Atoms, isotopes and the modern periodic table.",
    qs("dq-at", [
      [
        "What is the relative charge of a proton?",
        ["+1", "0", "−1", "+2"],
        0,
        "Protons carry a relative charge of +1; neutrons 0; electrons −1.",
      ],
      [
        "Isotopes of an element have the same number of…",
        ["Neutrons", "Protons", "Neutrons and protons", "Nucleons"],
        1,
        "Isotopes have the same number of protons but different numbers of neutrons.",
      ],
      [
        "An atom has a mass number of 23 and atomic number 11. How many neutrons does it have?",
        ["11", "12", "23", "34"],
        1,
        "Neutrons = mass number − atomic number = 23 − 11 = 12.",
      ],
      [
        "Who proposed the nuclear model of the atom after the gold foil experiment?",
        ["Dalton", "Thomson", "Rutherford", "Bohr"],
        2,
        "Rutherford's alpha-scattering experiment showed a small, dense, positive nucleus.",
      ],
      [
        "Elements in the same group of the periodic table have the same number of…",
        ["neutrons", "electron shells", "outer-shell electrons", "protons"],
        2,
        "The group number tells you the number of electrons in the outer shell.",
      ],
    ]),
  ),
  "demo-mcq-energy": mcqSet(
    "demo-mcq-energy",
    "Energy stores, transfers and the equations that go with them.",
    qs("dq-en", [
      [
        "A drawn bow holds energy in which store?",
        ["Kinetic", "Elastic potential", "Chemical", "Thermal"],
        1,
        "A stretched or compressed object stores elastic potential energy.",
      ],
      [
        "What is the kinetic energy of a 2 kg ball moving at 3 m/s?",
        ["6 J", "9 J", "18 J", "3 J"],
        1,
        "Eₖ = ½ × m × v² = ½ × 2 × 3² = 9 J.",
      ],
      [
        "Energy cannot be created or destroyed. It can only be…",
        ["used up", "transferred between stores", "turned into mass", "lost forever"],
        1,
        "This is the principle of conservation of energy.",
      ],
      [
        "A machine wastes energy mainly as…",
        ["light", "sound only", "thermal energy to the surroundings", "chemical energy"],
        2,
        "Friction and resistance heat the surroundings, which is wasted energy.",
      ],
      [
        "Which unit is energy measured in?",
        ["Watts", "Newtons", "Joules", "Volts"],
        2,
        "Energy is measured in joules (J). Power is joules per second — watts.",
      ],
    ]),
  ),
};

// ---------------------------------------------------------------------------
// Curriculum — a curated topic tree with spec points and attached resources.
// Consumed via CurriculumDAL, which serves these to the demo student.
// ---------------------------------------------------------------------------

const demoVid = (id: string, title: string, description: string, url: string): Resource => ({
  id,
  kind: "video",
  title,
  description,
  video_url: url,
  file_path: null,
  file_name: null,
  starts_at: null,
  join_url: null,
  due_at: null,
});
/** A curriculum homework link. The id must be a DEMO_HOMEWORK id so "Open" lands on a real sheet. */
const demoHw = (homeworkId: string): Resource => {
  const hw = DEMO_HOMEWORK.find((h) => h.id === homeworkId)!;
  return {
    id: hw.id,
    kind: "homework",
    title: hw.title,
    description: hw.instructions,
    video_url: null,
    file_path: null,
    file_name: null,
    starts_at: null,
    join_url: null,
    due_at: hw.due_at,
  };
};
const quiz = (id: string): McqSet => ({
  id,
  title: DEMO_MCQ_SETS.find((s) => s.id === id)!.title,
  published: true,
});

export const DEMO_CURRICULUM_TOPICS: Record<string, Topic[]> = {
  biology: [
    {
      id: "demo-topic-cells",
      code: "B1",
      title: "Cell Biology",
      description: "Cell structure, division and transport.",
      sort_order: 1,
    },
    {
      id: "demo-topic-organisation",
      code: "B2",
      title: "Organisation",
      description: "Tissues, organs and the digestive system.",
      sort_order: 2,
    },
    {
      id: "demo-topic-infection",
      code: "B3",
      title: "Infection & Response",
      description: "Pathogens, the immune system and drug development.",
      sort_order: 3,
    },
    {
      id: "demo-topic-bioenergetics",
      code: "B4",
      title: "Bioenergetics",
      description: "Photosynthesis and respiration.",
      sort_order: 4,
    },
  ],
  chemistry: [
    {
      id: "demo-topic-atomic",
      code: "C1",
      title: "Atomic Structure & the Periodic Table",
      description: "Atoms, isotopes and periodicity.",
      sort_order: 1,
    },
    {
      id: "demo-topic-bonding",
      code: "C2",
      title: "Bonding, Structure & Properties",
      description: "Ionic, covalent and metallic bonding.",
      sort_order: 2,
    },
    {
      id: "demo-topic-rates",
      code: "C6",
      title: "Rate of Chemical Change",
      description: "Measuring rates, collision theory and catalysts.",
      sort_order: 6,
    },
  ],
  physics: [
    {
      id: "demo-topic-energy",
      code: "P1",
      title: "Energy",
      description: "Energy stores, transfers and efficiency.",
      sort_order: 1,
    },
    {
      id: "demo-topic-electricity",
      code: "P2",
      title: "Electricity",
      description: "Current, potential difference and circuits.",
      sort_order: 2,
    },
  ],
};

export const DEMO_CURRICULUM_SPEC_POINTS: Record<string, SpecPoint[]> = {
  "demo-topic-cells": [
    {
      id: "demo-sp-cell-structure",
      topic_id: "demo-topic-cells",
      code: "4.1.1",
      title: "Cell structure",
      description: "Eukaryotic and prokaryotic cells and their sub-cellular structures.",
    },
    {
      id: "demo-sp-cell-division",
      topic_id: "demo-topic-cells",
      code: "4.1.2",
      title: "Cell division & mitosis",
      description: "The cell cycle, mitosis and stem cells.",
    },
    {
      id: "demo-sp-transport",
      topic_id: "demo-topic-cells",
      code: "4.1.3",
      title: "Transport in cells",
      description: "Diffusion, osmosis and active transport.",
    },
  ],
  "demo-topic-organisation": [
    {
      id: "demo-sp-digestion",
      topic_id: "demo-topic-organisation",
      code: "4.2.1",
      title: "The digestive system",
      description: "Enzymes and the products of digestion.",
    },
  ],
  "demo-topic-infection": [
    {
      id: "demo-sp-pathogens",
      topic_id: "demo-topic-infection",
      code: "4.3.1",
      title: "Communicable diseases",
      description: "Bacterial, viral, fungal and protist pathogens.",
    },
  ],
  "demo-topic-bioenergetics": [
    {
      id: "demo-sp-photosynthesis",
      topic_id: "demo-topic-bioenergetics",
      code: "4.4.1",
      title: "Photosynthesis",
      description: "The reaction, limiting factors and the inverse-square law.",
    },
    {
      id: "demo-sp-respiration",
      topic_id: "demo-topic-bioenergetics",
      code: "4.4.2",
      title: "Respiration",
      description: "Aerobic and anaerobic respiration and metabolism.",
    },
  ],
  "demo-topic-atomic": [
    {
      id: "demo-sp-atoms",
      topic_id: "demo-topic-atomic",
      code: "5.1.1",
      title: "Atoms & isotopes",
      description: "Atomic structure, isotopes and relative atomic mass.",
    },
  ],
  "demo-topic-bonding": [
    {
      id: "demo-sp-ionic",
      topic_id: "demo-topic-bonding",
      code: "5.2.1",
      title: "Ionic bonding",
      description: "Formation and properties of ionic compounds.",
    },
    {
      id: "demo-sp-covalent",
      topic_id: "demo-topic-bonding",
      code: "5.2.2",
      title: "Covalent bonding",
      description: "Shared pairs of electrons and simple molecules.",
    },
  ],
  "demo-topic-rates": [
    {
      id: "demo-sp-rates",
      topic_id: "demo-topic-rates",
      code: "5.6.1",
      title: "Rate of reaction",
      description: "Measuring rate, collision theory and the factors that affect it.",
    },
  ],
  "demo-topic-energy": [
    {
      id: "demo-sp-energy-stores",
      topic_id: "demo-topic-energy",
      code: "6.1.1",
      title: "Energy stores & transfers",
      description: "Kinetic, gravitational and elastic energy stores.",
    },
  ],
  "demo-topic-electricity": [
    {
      id: "demo-sp-circuits",
      topic_id: "demo-topic-electricity",
      code: "6.2.1",
      title: "Circuits & I–V characteristics",
      description: "Resistance, V = IR and how components behave.",
    },
    {
      id: "demo-sp-series",
      topic_id: "demo-topic-electricity",
      code: "6.2.2",
      title: "Series & parallel circuits",
      description: "Current, potential difference and resistance in each kind of circuit.",
    },
  ],
};

/**
 * What is attached to each spec point: a real video, and the demo quiz and
 * homework written for it. Every id resolves — "Take" opens a DEMO_MCQ set and
 * "Open" a DEMO_HOMEWORK sheet — so nothing in the curriculum is a dead link.
 */
export const DEMO_CURRICULUM_CONTENT: Record<string, { resources: Resource[]; mcqSets: McqSet[] }> =
  {
    "demo-sp-cell-structure": {
      resources: [
        demoVid(
          "demo-res-v-cells",
          "Cell Types & Cell Structure",
          "A tour of the animal, plant and bacterial cell.",
          DEMO_YT.cells,
        ),
      ],
      mcqSets: [quiz("demo-mcq-cells")],
    },
    "demo-sp-cell-division": {
      resources: [
        demoVid(
          "demo-res-v-mitosis",
          "Cell Division by Mitosis",
          "The cell cycle, stage by stage.",
          DEMO_YT.mitosis,
        ),
        demoHw("demo-hw-mitosis"),
      ],
      mcqSets: [quiz("demo-mcq-mitosis")],
    },
    "demo-sp-transport": {
      resources: [
        demoVid(
          "demo-res-v-transport",
          "Diffusion, Osmosis & Active Transport",
          "The three ways substances cross a membrane.",
          DEMO_YT.transport,
        ),
        demoVid(
          "demo-res-v-osmosis",
          "Required Practical: Osmosis in Potato Cells",
          "Method, results and percentage change in mass.",
          DEMO_YT.osmosis,
        ),
        demoHw("demo-hw-osmosis"),
      ],
      mcqSets: [quiz("demo-mcq-transport")],
    },
    "demo-sp-digestion": {
      resources: [
        demoVid(
          "demo-res-v-digestion",
          "The Digestive System",
          "Organs, enzymes and the products of digestion.",
          DEMO_YT.digestion,
        ),
      ],
      mcqSets: [],
    },
    "demo-sp-pathogens": {
      resources: [
        demoVid(
          "demo-res-v-pathogens",
          "Communicable Disease: Bacterial Disease",
          "How bacteria cause disease, with the examples you need.",
          DEMO_YT.pathogens,
        ),
      ],
      mcqSets: [],
    },
    "demo-sp-photosynthesis": {
      resources: [
        demoVid(
          "demo-res-v-photo",
          "Photosynthesis: Limiting Factors",
          "Light, CO₂ and temperature, and the graphs that go with them.",
          DEMO_YT.photosynthesis,
        ),
        demoVid(
          "demo-res-v-photo-practical",
          "Required Practical: Rates of Photosynthesis",
          "The pondweed practical, step by step.",
          DEMO_YT.photosynthesisPractical,
        ),
        demoHw("demo-hw-photosynthesis"),
      ],
      mcqSets: [quiz("demo-mcq-bioenergetics")],
    },
    "demo-sp-respiration": {
      resources: [
        demoVid(
          "demo-res-v-respiration",
          "Aerobic Respiration",
          "What it is, where it happens and the equation.",
          DEMO_YT.respiration,
        ),
      ],
      mcqSets: [],
    },
    "demo-sp-atoms": {
      resources: [
        demoVid(
          "demo-res-v-atoms",
          "Elements, Isotopes & Relative Atomic Mass",
          "Protons, neutrons, electrons and isotopes.",
          DEMO_YT.isotopes,
        ),
      ],
      mcqSets: [quiz("demo-mcq-atomic")],
    },
    "demo-sp-ionic": {
      resources: [
        demoVid(
          "demo-res-v-ionic",
          "Properties of Ionic Compounds",
          "Giant lattices and why they melt so high.",
          DEMO_YT.ionic,
        ),
      ],
      mcqSets: [quiz("demo-mcq-bonding")],
    },
    "demo-sp-covalent": {
      resources: [
        demoVid(
          "demo-res-v-covalent",
          "Covalent Bonding",
          "Shared pairs, and how to draw them.",
          DEMO_YT.covalent,
        ),
      ],
      mcqSets: [],
    },
    "demo-sp-rates": {
      resources: [
        demoVid(
          "demo-res-v-collision",
          "Factors Affecting Rate & Collision Theory",
          "Concentration, temperature, surface area and catalysts.",
          DEMO_YT.collision,
        ),
        demoVid(
          "demo-res-v-rates-practical",
          "Required Practical: Rates of Reaction",
          "The disappearing-cross method.",
          DEMO_YT.ratesPractical,
        ),
        demoHw("demo-hw-rates"),
      ],
      mcqSets: [],
    },
    "demo-sp-energy-stores": {
      resources: [
        demoVid(
          "demo-res-v-energy",
          "Energy Stores: a Worked Example",
          "Following the energy through an arrow's flight.",
          DEMO_YT.energyStores,
        ),
      ],
      mcqSets: [quiz("demo-mcq-energy")],
    },
    "demo-sp-circuits": {
      resources: [
        demoVid(
          "demo-res-v-iv",
          "Voltage, Current & Resistance — I–V Graphs",
          "V = IR and the three I–V graphs you need.",
          DEMO_YT.ivGraphs,
        ),
        demoHw("demo-hw-electricity"),
      ],
      mcqSets: [quiz("demo-mcq-electricity")],
    },
    "demo-sp-series": {
      resources: [
        demoVid(
          "demo-res-v-series",
          "Required Practical: Lamps in Series & Parallel",
          "What happens to current and brightness in each circuit.",
          DEMO_YT.seriesParallel,
        ),
      ],
      mcqSets: [],
    },
  };

/** Every demo spec point has bespoke content above; this only guards a missing key. */
export const DEMO_CURRICULUM_FALLBACK = (
  _point: SpecPoint,
): { resources: Resource[]; mcqSets: McqSet[] } => ({ resources: [], mcqSets: [] });
