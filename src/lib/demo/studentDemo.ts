import { isDemoMode, getDemoRole } from "@/lib/auth/session";
import type { SubjectAnalytics } from "@/hooks/data/useAnalytics";
import type { Topic, SpecPoint, Resource, McqSet } from "@/lib/curriculumDal";

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

export const DEMO_VIDEOS: DemoVideo[] = [
  {
    id: "demo-vid-1",
    title: "Photosynthesis: Light & Dark Reactions",
    description:
      "Full walkthrough of the two stages, with the balanced equation and limiting factors.",
    subject: "biology",
    board: "aqa",
    level: "gcse",
    video_url: "https://www.youtube.com/watch?v=demo",
  },
  {
    id: "demo-vid-2",
    title: "Required Practical: Osmosis in Potato Cells",
    description: "Step-by-step method, results table, and how to plot percentage change in mass.",
    subject: "biology",
    board: "aqa",
    level: "gcse",
    video_url: "https://www.youtube.com/watch?v=demo",
  },
  {
    id: "demo-vid-3",
    title: "Rates of Reaction — Collision Theory",
    description: "How concentration, temperature, surface area and catalysts affect rate.",
    subject: "chemistry",
    board: "aqa",
    level: "gcse",
    video_url: "https://www.youtube.com/watch?v=demo",
  },
  {
    id: "demo-vid-4",
    title: "Electricity: Series & Parallel Circuits",
    description: "Current, potential difference and resistance rules with worked examples.",
    subject: "physics",
    board: "aqa",
    level: "gcse",
    video_url: "https://www.youtube.com/watch?v=demo",
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
    board: "aqa",
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
    board: "aqa",
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
  specPoint: string;
};

export const DEMO_MCQ_SETS: DemoMcqSet[] = [
  {
    id: "demo-mcq-cells",
    title: "Cell Biology — Weekly Quiz",
    published: true,
    created_at: daysFromNow(-2),
    board: "aqa",
    level: "gcse",
    subject: "biology",
    topic: "Cell Biology",
    specPoint: "AQA 4.1 — Cell structure",
  },
  {
    id: "demo-mcq-bioenergetics",
    title: "Bioenergetics — Photosynthesis & Respiration",
    published: true,
    created_at: daysFromNow(-6),
    board: "aqa",
    level: "gcse",
    subject: "biology",
    topic: "Bioenergetics",
    specPoint: "AQA 4.4 — Photosynthesis",
  },
  {
    id: "demo-mcq-atomic",
    title: "Atomic Structure & The Periodic Table",
    published: true,
    created_at: daysFromNow(-9),
    board: "aqa",
    level: "gcse",
    subject: "chemistry",
    topic: "Atomic Structure",
    specPoint: "AQA 5.1 — Atoms",
  },
];

export type DemoMcqQuestion = {
  id: string;
  position: number;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
};

export const DEMO_MCQ: Record<
  string,
  {
    set: { id: string; title: string; description: string | null; published: boolean };
    questions: DemoMcqQuestion[];
  }
> = {
  "demo-mcq-cells": {
    set: {
      id: "demo-mcq-cells",
      title: "Cell Biology — Weekly Quiz",
      description: "Test your recall of cell structure and organelles.",
      published: true,
    },
    questions: [
      {
        id: "dq1",
        position: 0,
        question: "Which organelle is the site of aerobic respiration?",
        options: ["Nucleus", "Mitochondria", "Ribosome", "Chloroplast"],
        correct_index: 1,
        explanation: "Mitochondria carry out aerobic respiration, releasing energy from glucose.",
      },
      {
        id: "dq2",
        position: 1,
        question: "What structure do plant cells have that animal cells do not?",
        options: ["Cell membrane", "Cytoplasm", "Cell wall", "Mitochondria"],
        correct_index: 2,
        explanation: "Plant cells have a cellulose cell wall for support; animal cells do not.",
      },
      {
        id: "dq3",
        position: 2,
        question: "Prokaryotic cells differ from eukaryotic cells because they have no…",
        options: ["Cytoplasm", "Cell membrane", "Genetic material", "True nucleus"],
        correct_index: 3,
        explanation:
          "Prokaryotes have DNA free in the cytoplasm as a single loop, not enclosed in a nucleus.",
      },
    ],
  },
  "demo-mcq-bioenergetics": {
    set: {
      id: "demo-mcq-bioenergetics",
      title: "Bioenergetics — Photosynthesis & Respiration",
      description: "Photosynthesis, limiting factors and respiration.",
      published: true,
    },
    questions: [
      {
        id: "dq4",
        position: 0,
        question: "Which is a product of photosynthesis?",
        options: ["Carbon dioxide", "Oxygen", "Nitrogen", "Methane"],
        correct_index: 1,
        explanation: "Photosynthesis produces glucose and oxygen from carbon dioxide and water.",
      },
      {
        id: "dq5",
        position: 1,
        question: "Which of these is NOT a limiting factor of photosynthesis?",
        options: ["Light intensity", "CO₂ concentration", "Temperature", "Soil colour"],
        correct_index: 3,
        explanation: "Light, CO₂ and temperature limit the rate; soil colour does not.",
      },
    ],
  },
  "demo-mcq-atomic": {
    set: {
      id: "demo-mcq-atomic",
      title: "Atomic Structure & The Periodic Table",
      description: "Atoms, isotopes and the modern periodic table.",
      published: true,
    },
    questions: [
      {
        id: "dq6",
        position: 0,
        question: "What is the relative charge of a proton?",
        options: ["+1", "0", "-1", "+2"],
        correct_index: 0,
        explanation: "Protons carry a relative charge of +1; neutrons 0; electrons -1.",
      },
      {
        id: "dq7",
        position: 1,
        question: "Isotopes of an element have the same number of…",
        options: ["Neutrons", "Protons", "Neutrons and protons", "Nucleons"],
        correct_index: 1,
        explanation: "Isotopes have the same number of protons but different numbers of neutrons.",
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Curriculum — a curated topic tree with spec points and attached resources.
// Consumed via CurriculumDAL, which serves these to the demo student.
// ---------------------------------------------------------------------------

const demoVid = (id: string, title: string, description: string): Resource => ({
  id,
  kind: "video",
  title,
  description,
  video_url: "https://www.youtube.com/watch?v=demo",
  file_path: null,
  file_name: null,
  starts_at: null,
  join_url: null,
  due_at: null,
});
const demoHw = (id: string, title: string, description: string, dueDays: number): Resource => ({
  id,
  kind: "homework",
  title,
  description,
  video_url: null,
  file_path: null,
  file_name: null,
  starts_at: null,
  join_url: null,
  due_at: daysFromNow(dueDays),
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
      description: "Series and parallel circuits and component behaviour.",
    },
  ],
};

/** Attached resources/quizzes per spec point. MCQ set ids map into DEMO_MCQ so "Take" works. */
export const DEMO_CURRICULUM_CONTENT: Record<string, { resources: Resource[]; mcqSets: McqSet[] }> =
  {
    "demo-sp-cell-structure": {
      resources: [
        demoVid(
          "demo-res-v-cells",
          "Cell Structure & Organelles",
          "A tour of the animal, plant and bacterial cell.",
        ),
        demoHw(
          "demo-res-hw-cells",
          "Cell Structure Labelling Worksheet",
          "Label the organelles and describe their functions.",
          3,
        ),
      ],
      mcqSets: [{ id: "demo-mcq-cells", title: "Cell Biology — Weekly Quiz", published: true }],
    },
    "demo-sp-photosynthesis": {
      resources: [
        demoVid(
          "demo-res-v-photo",
          "Photosynthesis: Light & Dark Reactions",
          "The two stages and limiting factors.",
        ),
        demoHw(
          "demo-res-hw-photo",
          "Photosynthesis Practical & Limiting Factors",
          "Pondweed practical write-up and 6-mark question.",
          -6,
        ),
      ],
      mcqSets: [
        {
          id: "demo-mcq-bioenergetics",
          title: "Bioenergetics — Photosynthesis & Respiration",
          published: true,
        },
      ],
    },
    "demo-sp-atoms": {
      resources: [
        demoVid(
          "demo-res-v-atoms",
          "Atomic Structure Explained",
          "Protons, neutrons, electrons and isotopes.",
        ),
      ],
      mcqSets: [
        { id: "demo-mcq-atomic", title: "Atomic Structure & The Periodic Table", published: true },
      ],
    },
  };

/** Generic fallback content for spec points without bespoke fixtures. */
export const DEMO_CURRICULUM_FALLBACK = (
  point: SpecPoint,
): { resources: Resource[]; mcqSets: McqSet[] } => ({
  resources: [
    demoVid(
      `demo-res-v-${point.id}`,
      `${point.title} — Video Lesson`,
      `Full walkthrough of ${point.title.toLowerCase()}.`,
    ),
  ],
  mcqSets: [],
});
