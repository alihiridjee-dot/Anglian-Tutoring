import { isDemoMode, getDemoRole } from "@/lib/auth/session";
import { summariseAnalytics, type SubjectAnalytics } from "@/lib/profile/analytics";
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
 *
 * The grades are the ones Alex's tutor has recorded: the target is what Alex's
 * own Target ring shows, and the parent's page shows both. One fixture, so the
 * two pages can't disagree.
 */
export const DEMO_ENROLMENTS = [
  { subject: "biology", board: "edexcel", targetGrade: "9", currentGrade: "8" },
  { subject: "chemistry", board: "aqa", targetGrade: "8", currentGrade: "7" },
  { subject: "physics", board: "ocr", targetGrade: "8", currentGrade: "6" },
] as const;

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
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

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
    id: "demo-hw-atoms",
    title: "Atoms & Isotopes",
    instructions: "Use chlorine as your example throughout. Show your working on the calculation.",
    subject: "chemistry",
    due_at: daysFromNow(-10),
    created_at: daysFromNow(-17),
    origin: "tutor",
  },
  {
    id: "demo-hw-bonding",
    title: "Ionic Bonding: Explaining Properties",
    instructions:
      "Explain each property from the structure of sodium chloride. Full sentences, no diagrams needed.",
    subject: "chemistry",
    due_at: daysFromNow(2),
    created_at: daysFromNow(-2),
    origin: "tutor",
  },
  {
    id: "demo-hw-energy",
    title: "Energy Stores & Transfers",
    instructions: "Name the stores in every answer, and show each step of the calculation.",
    subject: "physics",
    due_at: daysFromNow(-8),
    created_at: daysFromNow(-15),
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
  // No due date, so these land in the practice section — which is where the
  // planner's per-spec-point sheets live for a real student. Each is titled as
  // the live generator titles one: the point's code, then its title.
  {
    id: "demo-hw-osmosis",
    title: "EDEX 1.15 Active, Passive & Osmotic Transport",
    instructions: null,
    subject: "biology",
    due_at: null,
    created_at: daysFromNow(-4),
    origin: "generated",
  },
  {
    id: "demo-hw-covalent",
    title: "AQA 4.2.1.4 Covalent bonding",
    instructions: null,
    subject: "chemistry",
    due_at: null,
    created_at: daysFromNow(-2),
    origin: "generated",
  },
  {
    id: "demo-hw-rates",
    title: "AQA 4.6.1.3 Collision theory and activation energy",
    instructions:
      "Sodium thiosulfate and hydrochloric acid. Describe the trend, then evaluate the method.",
    subject: "chemistry",
    due_at: null,
    created_at: daysFromNow(-5),
    origin: "generated",
  },
  {
    id: "demo-hw-series",
    title: "OCR P3.2i Resistance in series and parallel",
    instructions: null,
    subject: "physics",
    due_at: null,
    created_at: daysFromNow(-2),
    origin: "generated",
  },
];

/**
 * Submissions keyed by homework id: a marked task in every subject (two in
 * Biology), one still being marked, one set task not yet due, and four
 * untouched practice sheets.
 *
 * `score_pct` is the marks awarded over the marks available, rounded, and the
 * grade is that percentage on the predictor's scale (`gradeFromPct`) —
 * studentDemo.test.ts holds them to it.
 */
export const DEMO_SUBMISSIONS: Record<string, DemoSubmission> = {
  "demo-hw-photosynthesis": {
    id: "demo-sub-1",
    resource_id: "demo-hw-photosynthesis",
    student_id: "demo",
    notes: "I wasn't sure how to word the bit about the plateau.",
    submitted_at: daysFromNow(-7),
    grade: "8",
    score_pct: 83,
    feedback:
      "Full marks on Q1: you linked the slower rate to lower light intensity. On Q2 you showed light was no longer the limiting factor and named CO₂, but missed the last mark. End with 'the rate is limited by whichever factor is in shortest supply' and this is a grade 9 answer.",
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
    score_pct: 100,
    feedback:
      "Excellent. The stages are in the right order, and your DNA answer makes all four points, each linked to the next. This topic is exam-ready.",
    graded_at: daysFromNow(-1),
    acknowledged_at: null,
    release_at: null,
  },
  "demo-hw-bonding": {
    id: "demo-sub-3",
    resource_id: "demo-hw-bonding",
    student_id: "demo",
    notes:
      "I wasn't sure if it's the ions or the electrons that move when it melts, so I wrote 'charges'.",
    // Handed in a few minutes ago and still inside its review window, which is
    // the state the page explains rather than leaving blank. Marking takes
    // minutes, so the page promises the marks in about twenty.
    submitted_at: minutesFromNow(-10),
    grade: null,
    score_pct: null,
    feedback: null,
    graded_at: null,
    acknowledged_at: null,
    release_at: minutesFromNow(20),
  },
  "demo-hw-atoms": {
    id: "demo-sub-4",
    resource_id: "demo-hw-atoms",
    student_id: "demo",
    notes: "Is 35.5 right? I thought relative atomic mass would be a whole number.",
    submitted_at: daysFromNow(-11),
    grade: "8",
    score_pct: 83,
    feedback:
      "Full marks on Q2: clear working and the right answer. And yes, 35.5 is right. Relative atomic mass is an average of the isotopes, weighted by how common each one is, so it doesn't have to be a whole number. On Q1 you defined isotopes well but missed the last mark, because the question asked you to use chlorine. Add 'both have 17 protons, so chlorine-35 has 18 neutrons and chlorine-37 has 20' and this is a full-mark answer.",
    graded_at: daysFromNow(-7),
    acknowledged_at: null,
    release_at: null,
  },
  "demo-hw-energy": {
    id: "demo-sub-5",
    resource_id: "demo-hw-energy",
    student_id: "demo",
    notes: "My speed in Q2 seemed really fast, but I couldn't find the mistake.",
    submitted_at: daysFromNow(-9),
    grade: "7",
    score_pct: 71,
    feedback:
      "A solid task, and you were right to doubt 64 m/s. v² = 64, so v is the square root: 8 m/s. Asking whether an answer is sensible is the habit that catches slips like this, so keep doing it. In Q1 you named two stores but not the third: air resistance transfers some energy to the thermal store of the surroundings. Put those two right and this is full marks.",
    graded_at: daysFromNow(-5),
    acknowledged_at: null,
    release_at: null,
  },
  // demo-hw-electricity and the four practice sheets intentionally have no
  // submission: one set task not yet due, and sheets nobody has started.
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
  "demo-hw-atoms": [
    {
      id: "demo-q-at-1",
      resource_id: "demo-hw-atoms",
      position: 0,
      prompt:
        "Chlorine has two isotopes, chlorine-35 and chlorine-37. Explain what isotopes are, using these two as your example.",
      marks: 3,
      answer_type: "short",
      mark_scheme:
        "Atoms of the same element, with the same number of protons (1). Different numbers of neutrons (1). Both have 17 protons; chlorine-35 has 18 neutrons and chlorine-37 has 20 (1).",
      spec_point_id: null,
    },
    {
      id: "demo-q-at-2",
      resource_id: "demo-hw-atoms",
      position: 1,
      prompt:
        "75% of chlorine atoms are chlorine-35 and 25% are chlorine-37. Calculate the relative atomic mass of chlorine. Show your working.",
      marks: 3,
      answer_type: "short",
      mark_scheme: "(35 × 75) + (37 × 25) (1). Total ÷ 100 (1). = 35.5 (1).",
      spec_point_id: null,
    },
  ],
  "demo-hw-bonding": [
    {
      id: "demo-q-bo-1",
      resource_id: "demo-hw-bonding",
      position: 0,
      prompt:
        "Describe what happens to the electrons when sodium reacts with chlorine to form sodium chloride.",
      marks: 2,
      answer_type: "short",
      mark_scheme:
        "A sodium atom loses its one outer electron, forming a Na⁺ ion (1). A chlorine atom gains that electron, forming a Cl⁻ ion (1).",
      spec_point_id: null,
    },
    {
      id: "demo-q-bo-2",
      resource_id: "demo-hw-bonding",
      position: 1,
      prompt:
        "Explain why sodium chloride has a high melting point, and why it conducts electricity when molten but not when solid.",
      marks: 4,
      answer_type: "long",
      mark_scheme:
        "Giant ionic lattice (1). Strong electrostatic forces of attraction between oppositely charged ions take a lot of energy to overcome (1). In the solid the ions are held in place and cannot move (1). When molten the ions are free to move and carry charge (1).",
      spec_point_id: null,
    },
  ],
  "demo-hw-energy": [
    {
      id: "demo-q-en-1",
      resource_id: "demo-hw-energy",
      position: 0,
      prompt:
        "A ball is dropped from a height. Describe how energy is transferred between stores as it falls.",
      marks: 3,
      answer_type: "short",
      mark_scheme:
        "Energy in the gravitational potential store decreases (1). Energy in the kinetic store increases (1). Some energy is transferred to the thermal store of the surroundings by air resistance (1).",
      spec_point_id: null,
    },
    {
      id: "demo-q-en-2",
      resource_id: "demo-hw-energy",
      position: 1,
      prompt:
        "A 0.5 kg ball is dropped from a height of 3.2 m. Calculate the gravitational potential energy it loses, then its speed just before it lands. Ignore air resistance. Gravitational field strength = 10 N/kg.",
      marks: 4,
      answer_type: "numeric",
      mark_scheme:
        "Eₚ = m × g × h = 0.5 × 10 × 3.2 (1) = 16 J (1). All of it becomes kinetic energy: 16 = ½ × 0.5 × v² (1). v² = 64, so v = 8 m/s (1).",
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
  "demo-hw-covalent": [
    {
      id: "demo-q-co-1",
      resource_id: "demo-hw-covalent",
      position: 0,
      prompt: "What is a covalent bond, and between which kind of atoms does it form?",
      marks: 2,
      answer_type: "short",
      mark_scheme: "A shared pair of electrons (1). Between non-metal atoms (1).",
      spec_point_id: null,
    },
    {
      id: "demo-q-co-2",
      resource_id: "demo-hw-covalent",
      position: 1,
      prompt:
        "Methane is made of small molecules. Explain why methane has a low boiling point, even though its covalent bonds are strong.",
      marks: 3,
      answer_type: "long",
      mark_scheme:
        "The forces between methane molecules (intermolecular forces) are weak (1). Little energy is needed to overcome them (1). The covalent bonds inside the molecules do not break when methane boils (1).",
      spec_point_id: null,
    },
  ],
  "demo-hw-series": [
    {
      id: "demo-q-se-1",
      resource_id: "demo-hw-series",
      position: 0,
      prompt:
        "Two identical lamps are connected in series to a 6 V battery. What is the potential difference across each lamp? Explain your answer.",
      marks: 2,
      answer_type: "short",
      mark_scheme:
        "3 V (1). In series, the potential difference of the supply is shared between the components (1).",
      spec_point_id: null,
    },
    {
      id: "demo-q-se-2",
      resource_id: "demo-hw-series",
      position: 1,
      prompt:
        "Two identical lamps are connected in parallel to a battery. One lamp breaks. Explain what happens to the other lamp.",
      marks: 3,
      answer_type: "long",
      mark_scheme:
        "It stays lit (1). It is on its own branch, so there is still a complete circuit through it (1). The potential difference across it is unchanged, so its brightness does not change (1).",
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
    feedback:
      "Both marks: the rate falls, and you gave the reason. In the exam, write 'light intensity decreases' rather than 'the light is weaker', as that is the wording mark schemes use.",
  },
  "demo-q-ps-2": {
    id: "demo-a-ps-2",
    submission_id: "demo-sub-1",
    question_id: "demo-q-ps-2",
    answer_text:
      "Because light isn't the thing holding it back any more. Something else becomes the limiting factor, like carbon dioxide, so making the lamp brighter doesn't help.",
    awarded_marks: 3,
    feedback:
      "Three marks: light is no longer limiting, another factor takes over, and you named CO₂. The fourth needs one more sentence: the rate is limited by whichever factor is in shortest supply.",
  },
  "demo-q-mi-1": {
    id: "demo-a-mi-1",
    submission_id: "demo-sub-2",
    question_id: "demo-q-mi-1",
    answer_text: "Interphase, then mitosis, then cytokinesis.",
    awarded_marks: 3,
    feedback: "All three marks: interphase, mitosis, cytokinesis, in the right order.",
  },
  "demo-q-mi-2": {
    id: "demo-a-mi-2",
    submission_id: "demo-sub-2",
    question_id: "demo-q-mi-2",
    answer_text:
      "So each new cell gets a complete copy of the DNA. If it wasn't copied first the two cells would end up with half each and lose genetic information. The copies are identical, which is what you need for growth and repair.",
    awarded_marks: 4,
    feedback:
      "Full marks, with all four points linked: each new cell gets a complete copy, no genetic information is lost, the copies are identical, and that is what growth and repair need.",
  },
  // Handed in and still being marked, so no marks or feedback yet.
  "demo-q-bo-1": {
    id: "demo-a-bo-1",
    submission_id: "demo-sub-3",
    question_id: "demo-q-bo-1",
    answer_text:
      "Sodium loses its one outer electron and becomes Na⁺. Chlorine gains that electron and becomes Cl⁻, so both end up with a full outer shell.",
    awarded_marks: null,
    feedback: null,
  },
  "demo-q-bo-2": {
    id: "demo-a-bo-2",
    submission_id: "demo-sub-3",
    question_id: "demo-q-bo-2",
    answer_text:
      "Sodium chloride is a giant ionic lattice with strong electrostatic forces between the oppositely charged ions. It takes a lot of energy to overcome them, so the melting point is high. When it is solid it can't conduct, but when it melts the charges are free to move and carry the current.",
    awarded_marks: null,
    feedback: null,
  },
  "demo-q-at-1": {
    id: "demo-a-at-1",
    submission_id: "demo-sub-4",
    question_id: "demo-q-at-1",
    answer_text:
      "Isotopes are atoms of the same element with the same number of protons but a different number of neutrons, so their mass numbers are different.",
    awarded_marks: 2,
    feedback:
      "Two marks: same number of protons, different numbers of neutrons. The third was for using chlorine, as the question asked: both have 17 protons, so chlorine-35 has 18 neutrons and chlorine-37 has 20.",
  },
  "demo-q-at-2": {
    id: "demo-a-at-2",
    submission_id: "demo-sub-4",
    question_id: "demo-q-at-2",
    answer_text: "(35 × 75) + (37 × 25) = 2625 + 925 = 3550. Then 3550 ÷ 100 = 35.5",
    awarded_marks: 3,
    feedback:
      "All three marks: the right method, every step shown, and the right answer. Setting it out like this keeps the method marks even if a number slips.",
  },
  "demo-q-en-1": {
    id: "demo-a-en-1",
    submission_id: "demo-sub-5",
    question_id: "demo-q-en-1",
    answer_text:
      "As it falls it loses gravitational potential energy and gains kinetic energy, because it speeds up.",
    awarded_marks: 2,
    feedback:
      "Two marks: the gravitational potential store goes down as the kinetic store goes up. The third is for the energy that doesn't become kinetic: air resistance transfers some to the thermal store of the surroundings.",
  },
  "demo-q-en-2": {
    id: "demo-a-en-2",
    submission_id: "demo-sub-5",
    question_id: "demo-q-en-2",
    answer_text:
      "GPE = mgh = 0.5 × 10 × 3.2 = 16 J. All of it turns into kinetic energy, so 16 = ½ × 0.5 × v². v² = 16 ÷ 0.25 = 64, so the speed is 64 m/s.",
    awarded_marks: 3,
    feedback:
      "Three marks: 16 J is right, and setting it equal to ½mv² was the key step. The last mark slipped at the very end: v² = 64, so v is the square root, 8 m/s.",
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
  /**
   * The demo spec point the video teaches — the showcase's stand-in for a live
   * `resource_spec_points` link, so "From your tutor" shows the video for the
   * pinned point rather than every video in the subject.
   */
  spec_point_id?: string;
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
    spec_point_id: "demo-sp-photosynthesis",
  },
  {
    id: "demo-vid-2",
    title: "Core Practical: Osmosis in Potatoes",
    description: "Step-by-step method, results table, and how to plot percentage change in mass.",
    subject: "biology",
    board: "edexcel",
    level: "gcse",
    video_url: DEMO_YT.osmosis,
    spec_point_id: "demo-sp-osmosis-practical",
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
    title: "Practical: Lamps in Series & Parallel",
    description:
      "What happens to current and brightness when lamps are wired in series and in parallel.",
    subject: "physics",
    board: "ocr",
    level: "gcse",
    video_url: DEMO_YT.seriesParallel,
    spec_point_id: "demo-sp-series",
  },
  {
    id: "demo-vid-5",
    title: "Ionic Bonding & the Properties of Ionic Compounds",
    description: "Why ionic compounds form giant lattices, and why they melt so high.",
    subject: "chemistry",
    board: "aqa",
    level: "gcse",
    video_url: DEMO_YT.ionic,
    spec_point_id: "demo-sp-ionic",
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
  /**
   * The demo spec points the lesson covers — the showcase's stand-in for the
   * live `resource_spec_points` links. It drives the session's "What's
   * covered" and lists the session on each of those points in the curriculum.
   */
  specPoints: Array<{ id: string; code: string; title: string }>;
};

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
 * The demo's quizzes, as the Weekly MCQs page lists them. Every set is fixture
 * content — there is no generation, no read of `mcq_sets`, and no attempt is
 * ever written. A real student's quizzes are generated per spec point by
 * `ensureMcqForPoints`; nothing here reaches it.
 *
 * Like the live page, this lists only points Alex's plan has reached. Quizzes
 * on later topics are in DEMO_MCQ_SETS_LATER, which only the curriculum shows.
 */
export const DEMO_MCQ_SETS: DemoMcqSet[] = [
  // This week's work — the core points on the demo planner, two per subject.
  {
    id: "demo-mcq-transport",
    title: "Transport in Cells — Diffusion, Osmosis & Active Transport",
    published: true,
    created_at: daysFromNow(-1),
    board: "edexcel",
    level: "gcse",
    subject: "biology",
    topic: "Key concepts in biology",
    topicSort: 1,
    specPoint: "EDEX 1.15",
    thisWeek: true,
  },
  {
    id: "demo-mcq-osmosis-practical",
    title: "Core Practical: Osmosis in Potatoes",
    published: true,
    created_at: daysFromNow(-1),
    board: "edexcel",
    level: "gcse",
    subject: "biology",
    topic: "Key concepts in biology",
    topicSort: 1,
    specPoint: "EDEX 1.16",
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
    topic: "Bonding, structure, and the properties of matter",
    topicSort: 2,
    specPoint: "AQA 4.2.1.2",
    thisWeek: true,
  },
  {
    id: "demo-mcq-covalent",
    title: "Covalent Bonding",
    published: true,
    created_at: daysFromNow(-1),
    board: "aqa",
    level: "gcse",
    subject: "chemistry",
    topic: "Bonding, structure, and the properties of matter",
    topicSort: 2,
    specPoint: "AQA 4.2.1.4",
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
    topicSort: 3,
    specPoint: "OCR P3.2g",
    thisWeek: true,
  },
  {
    id: "demo-mcq-series",
    title: "Series & Parallel Circuits",
    published: true,
    created_at: daysFromNow(-1),
    board: "ocr",
    level: "gcse",
    subject: "physics",
    topic: "Electricity",
    topicSort: 3,
    specPoint: "OCR P3.2i",
    thisWeek: true,
  },
  // Earlier weeks — already attempted, so the archive shows scores.
  {
    id: "demo-mcq-cells",
    title: "Cell Structure",
    published: true,
    // Last week: Topic 1's first week on the road to the exam.
    created_at: daysFromNow(-6),
    board: "edexcel",
    level: "gcse",
    subject: "biology",
    topic: "Key concepts in biology",
    topicSort: 1,
    specPoint: "EDEX 1.1",
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
    topic: "Cells and control",
    topicSort: 2,
    specPoint: "EDEX 2.1",
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
    topic: "Plant structures and their functions",
    topicSort: 6,
    specPoint: "EDEX 6.3",
    thisWeek: false,
  },
  {
    id: "demo-mcq-respiration",
    title: "Aerobic & Anaerobic Respiration",
    published: true,
    created_at: daysFromNow(-20),
    board: "edexcel",
    level: "gcse",
    subject: "biology",
    topic: "Exchange and transport in animals",
    topicSort: 8,
    specPoint: "EDEX 8.9",
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
    topic: "Atomic structure and the periodic table",
    topicSort: 1,
    specPoint: "AQA 4.1.1.5",
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
    topicSort: 7,
    specPoint: "OCR P7.1b",
    thisWeek: false,
  },
];

/**
 * Quizzes on points Alex's plan hasn't reached yet: enzymes is still to come in
 * Biology's Topic 1, which is under way; Biology's Topic 5 starts in thirteen
 * weeks and Chemistry's Topic 6 in fifteen (see DEMO_ROADMAP in plannerDemo.ts).
 * The curriculum shows them on their spec points, but the Weekly MCQs page
 * leaves them out, as it does for a real student: its "Past MCQs" are what has
 * been covered, and these haven't been.
 */
export const DEMO_MCQ_SETS_LATER: DemoMcqSet[] = [
  {
    id: "demo-mcq-digestion",
    title: "Enzymes & Digestion",
    published: true,
    created_at: daysFromNow(-3),
    board: "edexcel",
    level: "gcse",
    subject: "biology",
    topic: "Key concepts in biology",
    topicSort: 1,
    specPoint: "EDEX 1.12",
    thisWeek: false,
  },
  {
    id: "demo-mcq-pathogens",
    title: "Communicable Diseases",
    published: true,
    created_at: daysFromNow(-3),
    board: "edexcel",
    level: "gcse",
    subject: "biology",
    topic: "Health, disease and the development of medicines",
    topicSort: 5,
    specPoint: "EDEX 5.4",
    thisWeek: false,
  },
  {
    id: "demo-mcq-rates",
    title: "Rates of Reaction",
    published: true,
    created_at: daysFromNow(-3),
    board: "aqa",
    level: "gcse",
    subject: "chemistry",
    topic: "The rate and extent of chemical change",
    topicSort: 6,
    specPoint: "AQA 4.6.1.3",
    thisWeek: false,
  },
];

const allMcqSets = () => [...DEMO_MCQ_SETS, ...DEMO_MCQ_SETS_LATER];

/**
 * The demo student's best score on each set they've taken, out of the set's
 * length. Each subject has one of this week's quizzes done and one still to
 * do, so a visitor can try one.
 */
export const DEMO_MCQ_ATTEMPTS: Record<string, { score: number; total: number }> = {
  "demo-mcq-cells": { score: 5, total: 5 },
  "demo-mcq-mitosis": { score: 4, total: 5 },
  "demo-mcq-bioenergetics": { score: 4, total: 5 },
  "demo-mcq-respiration": { score: 5, total: 5 },
  "demo-mcq-osmosis-practical": { score: 5, total: 5 },
  "demo-mcq-atomic": { score: 4, total: 5 },
  "demo-mcq-bonding": { score: 4, total: 5 },
  "demo-mcq-energy": { score: 3, total: 5 },
  "demo-mcq-electricity": { score: 4, total: 5 },
};

/** The predicted grade per subject: fixed, and the grade the averages below give. */
const DEMO_PREDICTED_GRADE: Record<string, number> = { biology: 9, chemistry: 8, physics: 7 };

/**
 * Alex's scored work, as `student_scored_work` returns it for a real student:
 * every quiz taken and every marked task, with its subject and percentage.
 */
export const DEMO_SCORED_WORK = {
  quizzes: Object.entries(DEMO_MCQ_ATTEMPTS).map(([setId, a]) => ({
    subject: allMcqSets().find((s) => s.id === setId)?.subject,
    pct: (a.score * 100) / a.total,
  })),
  tasks: DEMO_HOMEWORK.flatMap((h) => {
    const sub = DEMO_SUBMISSIONS[h.id];
    return sub?.graded_at && sub.score_pct != null
      ? [{ subject: h.subject, pct: sub.score_pct }]
      : [];
  }),
};

/**
 * Alex's progress per subject, worked out from the fixtures above the way the
 * live app works it out from real work. It used to be typed in by hand and
 * drifted: the parent's page counted 14 Biology quizzes and 8 marked tasks
 * while Alex's own pages showed 3 and 2. Only the predicted grade is fixed,
 * and studentDemo.test.ts checks it is the grade these averages give.
 */
export const DEMO_ANALYTICS: SubjectAnalytics[] = summariseAnalytics(
  DEMO_SUBJECTS,
  DEMO_SCORED_WORK.quizzes,
  DEMO_SCORED_WORK.tasks,
).map((row) => ({ ...row, predictedGrade: DEMO_PREDICTED_GRADE[row.subject] }));

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
  const meta = allMcqSets().find((s) => s.id === id)!;
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
  "demo-mcq-osmosis-practical": mcqSet(
    "demo-mcq-osmosis-practical",
    "The potato practical: the method, the calculation and what the graph tells you.",
    qs("dq-rp", [
      [
        "Why are the potato pieces blotted dry before they are weighed at the end?",
        [
          "To stop osmosis",
          "To remove water on the surface, which would add to the mass",
          "To kill the cells",
          "To make every piece the same length",
        ],
        1,
        "Water on the outside isn't inside the cells. Left on, it would make the change in mass look bigger than it is.",
      ],
      [
        "Why is the percentage change in mass worked out, rather than just the change in mass?",
        [
          "It is quicker to calculate",
          "The pieces start at different masses, so percentages compare them fairly",
          "It makes every result positive",
          "The balance only reads percentages",
        ],
        1,
        "A heavier piece gains or loses more grams. Percentages let pieces of different starting mass be compared.",
      ],
      [
        "A potato piece goes from 2.0 g to 2.5 g. What is the percentage change in mass?",
        ["+0.5%", "+20%", "+25%", "+125%"],
        2,
        "(2.5 − 2.0) ÷ 2.0 × 100 = +25%. Always divide by the starting mass.",
      ],
      [
        "In which solution would the potato pieces lose the most mass?",
        [
          "Distilled water",
          "0.2 mol/dm³ sugar solution",
          "0.5 mol/dm³ sugar solution",
          "1.0 mol/dm³ sugar solution",
        ],
        3,
        "The most concentrated solution draws the most water out of the cells by osmosis.",
      ],
      [
        "On a graph of percentage change in mass against concentration, what does the point where the line crosses zero show?",
        [
          "The concentration of the solution inside the potato cells",
          "The point where the potato cells die",
          "The temperature of the solution",
          "The starting mass of the potato",
        ],
        0,
        "No change in mass means no net movement of water, so the solution matches the concentration inside the cells.",
      ],
    ]),
  ),
  "demo-mcq-covalent": mcqSet(
    "demo-mcq-covalent",
    "Shared pairs of electrons, and why simple molecules melt and boil so easily.",
    qs("dq-co", [
      [
        "A covalent bond is…",
        [
          "a shared pair of electrons",
          "the transfer of electrons from a metal to a non-metal",
          "the attraction between positive ions and delocalised electrons",
          "the attraction between two oppositely charged ions",
        ],
        0,
        "In a covalent bond two atoms share a pair of electrons. It forms between non-metal atoms.",
      ],
      [
        "Which of these substances is held together by covalent bonds?",
        ["Sodium chloride", "Magnesium", "Water", "Calcium oxide"],
        2,
        "Hydrogen and oxygen are both non-metals, so they share electrons. Sodium chloride and calcium oxide are ionic; magnesium is metallic.",
      ],
      [
        "How many covalent bonds does the carbon atom form in methane, CH₄?",
        ["1", "2", "3", "4"],
        3,
        "Carbon has four outer electrons, so it shares one with each of four hydrogen atoms.",
      ],
      [
        "Why does methane have a low boiling point?",
        [
          "Its covalent bonds are weak",
          "The forces between its molecules are weak",
          "Its ions move easily",
          "It has delocalised electrons",
        ],
        1,
        "Boiling separates the molecules, which only means overcoming the weak forces between them. The strong covalent bonds inside each molecule don't break.",
      ],
      [
        "Why don't simple molecular substances conduct electricity?",
        [
          "Their molecules are too large",
          "Their molecules have no overall charge, so nothing charged can move",
          "Their covalent bonds are too strong",
          "They are always gases",
        ],
        1,
        "To conduct, charged particles must be free to move. Molecules have no overall electric charge, and there are no free ions or electrons.",
      ],
    ]),
  ),
  "demo-mcq-series": mcqSet(
    "demo-mcq-series",
    "Current, potential difference and resistance in series and in parallel.",
    qs("dq-se", [
      [
        "In a series circuit, the potential difference of the supply is…",
        [
          "the same across every component",
          "shared between the components",
          "zero across each lamp",
          "only across the biggest resistor",
        ],
        1,
        "In series the supply's potential difference is shared between the components, while the current is the same everywhere.",
      ],
      [
        "In a parallel circuit, the potential difference across each branch is…",
        [
          "shared equally between the branches",
          "the same as the supply's",
          "zero",
          "largest across the biggest resistor",
        ],
        1,
        "Each branch connects straight across the supply, so each has the supply's full potential difference.",
      ],
      [
        "Resistors of 4 Ω and 6 Ω are connected in series. What is the total resistance?",
        ["2.4 Ω", "10 Ω", "24 Ω", "1.5 Ω"],
        1,
        "In series, resistances add: 4 + 6 = 10 Ω.",
      ],
      [
        "A second resistor is added in parallel with the first. What happens to the total resistance?",
        ["It increases", "It decreases", "It stays the same", "It becomes zero"],
        1,
        "The current has another path to take, so the total resistance falls. It ends up less than the smallest single resistor.",
      ],
      [
        "Two branches of a parallel circuit carry 0.2 A and 0.3 A. What is the current through the cell?",
        ["0.1 A", "0.25 A", "0.5 A", "0.06 A"],
        2,
        "The branch currents add up to the total: 0.2 + 0.3 = 0.5 A.",
      ],
    ]),
  ),
  "demo-mcq-respiration": mcqSet(
    "demo-mcq-respiration",
    "Aerobic and anaerobic respiration, in muscles and in yeast.",
    qs("dq-re", [
      [
        "Respiration is an exothermic reaction. This means it…",
        [
          "transfers energy to the environment",
          "takes in energy from the environment",
          "only happens in animals",
          "is the same as breathing",
        ],
        0,
        "Respiration transfers energy from glucose. It happens all the time in every living cell, plant cells included.",
      ],
      [
        "What are the products of aerobic respiration?",
        [
          "Glucose and oxygen",
          "Carbon dioxide and water",
          "Lactic acid",
          "Ethanol and carbon dioxide",
        ],
        1,
        "Glucose + oxygen → carbon dioxide + water.",
      ],
      [
        "What do muscles make when they respire anaerobically?",
        ["Carbon dioxide and water", "Ethanol", "Lactic acid", "Oxygen"],
        2,
        "When muscles run short of oxygen during hard exercise, glucose is turned into lactic acid.",
      ],
      [
        "Anaerobic respiration in yeast is called…",
        ["photosynthesis", "fermentation", "digestion", "diffusion"],
        1,
        "Yeast turns glucose into ethanol and carbon dioxide. This is fermentation, used in brewing and bread-making.",
      ],
      [
        "Why does anaerobic respiration transfer less energy than aerobic respiration?",
        [
          "It happens more quickly",
          "The glucose is not fully oxidised",
          "It uses more oxygen",
          "It only happens in plants",
        ],
        1,
        "Without oxygen, glucose is only partly broken down, so much less energy is transferred.",
      ],
    ]),
  ),
  "demo-mcq-digestion": mcqSet(
    "demo-mcq-digestion",
    "The enzymes of digestion, what they make, and what bile does.",
    qs("dq-di", [
      [
        "Which enzyme breaks down starch?",
        ["Protease", "Lipase", "Amylase", "Bile"],
        2,
        "Amylase, a carbohydrase, breaks starch down into sugars.",
      ],
      [
        "Proteins are broken down into…",
        ["amino acids", "glucose", "fatty acids and glycerol", "starch"],
        0,
        "Proteases break proteins down into amino acids.",
      ],
      [
        "Lipase breaks lipids down into…",
        ["amino acids", "sugars", "fatty acids and glycerol", "starch"],
        2,
        "Lipids (fats and oils) are broken down by lipase into fatty acids and glycerol.",
      ],
      [
        "Bile is made in the liver. What does it do?",
        [
          "Breaks proteins into amino acids",
          "Neutralises stomach acid and emulsifies fats",
          "Absorbs water",
          "Makes amylase",
        ],
        1,
        "Bile is alkaline, so it neutralises stomach acid. It also breaks fat into small droplets, giving lipase a larger surface area to work on.",
      ],
      [
        "Why does an enzyme stop working at a high temperature?",
        [
          "It runs out of substrate",
          "Its active site changes shape, so the substrate no longer fits",
          "It moves too fast to collide",
          "It turns into a different enzyme",
        ],
        1,
        "Too much heat denatures the enzyme: the active site changes shape and the substrate can't fit.",
      ],
    ]),
  ),
  "demo-mcq-pathogens": mcqSet(
    "demo-mcq-pathogens",
    "Viruses, bacteria, fungi and protists, and how the body fights them.",
    qs("dq-pa", [
      [
        "What type of pathogen causes measles?",
        ["A bacterium", "A virus", "A fungus", "A protist"],
        1,
        "Measles is caused by a virus and spreads in droplets from coughs and sneezes.",
      ],
      [
        "How is malaria spread?",
        [
          "In droplets from coughs",
          "By mosquitoes",
          "In contaminated water",
          "By touching infected skin",
        ],
        1,
        "Malaria is caused by a protist. Mosquitoes carry it from person to person: they are the vector.",
      ],
      [
        "Antibiotics can be used to treat…",
        [
          "viral infections such as measles",
          "bacterial infections such as Salmonella food poisoning",
          "every communicable disease",
          "fungal infections only",
        ],
        1,
        "Antibiotics kill bacteria. They have no effect on viruses, which reproduce inside the body's own cells.",
      ],
      [
        "Rose black spot is caused by…",
        ["a virus", "a bacterium", "a fungus", "a protist"],
        2,
        "Rose black spot is a fungal disease. Its spores spread in water and on the wind.",
      ],
      [
        "Which of these is NOT a way white blood cells defend the body?",
        [
          "Engulfing pathogens",
          "Producing antibodies",
          "Producing antitoxins",
          "Producing stomach acid",
        ],
        3,
        "White blood cells engulf pathogens and make antibodies and antitoxins. Stomach acid is made by the stomach, and kills pathogens that are swallowed.",
      ],
    ]),
  ),
  "demo-mcq-rates": mcqSet(
    "demo-mcq-rates",
    "Collision theory and the four things that change how fast a reaction goes.",
    qs("dq-ra", [
      [
        "According to collision theory, a reaction happens when particles…",
        [
          "collide with at least the activation energy",
          "move apart",
          "stop moving",
          "collide with any amount of energy",
        ],
        0,
        "Particles must collide, and with enough energy — at least the activation energy — for a reaction to happen.",
      ],
      [
        "Why does increasing the concentration of a solution increase the rate?",
        [
          "The particles move faster",
          "There are more particles in the same volume, so collisions are more frequent",
          "The activation energy is lowered",
          "The particles get bigger",
        ],
        1,
        "More particles in the same volume means more frequent collisions, so more successful ones each second.",
      ],
      [
        "Why does increasing the temperature increase the rate?",
        [
          "Particles move faster, so they collide more often and with more energy",
          "The activation energy goes up",
          "The concentration increases",
          "More product can be made",
        ],
        0,
        "Faster particles collide more often, and more of those collisions have at least the activation energy.",
      ],
      [
        "Why does a powder react faster than a lump of the same solid?",
        [
          "It has a larger surface area to volume ratio",
          "It is at a higher temperature",
          "It contains a catalyst",
          "It has a lower concentration",
        ],
        0,
        "More of the solid is exposed, so collisions with it are more frequent.",
      ],
      [
        "How does a catalyst increase the rate of a reaction?",
        [
          "It is used up as the reaction goes",
          "It provides a different pathway with a lower activation energy",
          "It raises the temperature",
          "It increases the concentration",
        ],
        1,
        "A catalyst isn't used up. It gives the reaction a different route with a lower activation energy.",
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
  title: allMcqSets().find((s) => s.id === id)!.title,
  published: true,
});
/** The DEMO_LIVE sessions that list this point as covered, as curriculum resources. */
const liveOn = (pointId: string): Resource[] =>
  DEMO_LIVE.filter((s) => s.specPoints.some((p) => p.id === pointId)).map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    description: s.description,
    video_url: null,
    file_path: null,
    file_name: null,
    starts_at: s.starts_at,
    join_url: s.join_url,
    due_at: null,
  }));

/**
 * Each subject is labelled with its own board's codes and topic names, as the
 * production curriculum stores them: Biology is Edexcel, Chemistry AQA and
 * Physics OCR (see DEMO_ENROLMENTS). Topic titles drop the "Topic N:" prefix
 * that some boards repeat in the title, since the code already says it.
 */
export const DEMO_CURRICULUM_TOPICS: Record<string, Topic[]> = {
  biology: [
    {
      id: "demo-topic-cells",
      code: "Topic 1",
      title: "Key concepts in biology",
      description: "Cells, enzymes and how substances move in and out of cells.",
      sort_order: 1,
    },
    {
      id: "demo-topic-cell-control",
      code: "Topic 2",
      title: "Cells and control",
      description: "Mitosis, growth, stem cells and the nervous system.",
      sort_order: 2,
    },
    {
      id: "demo-topic-infection",
      code: "Topic 5",
      title: "Health, disease and the development of medicines",
      description: "Pathogens, the immune system and drug development.",
      sort_order: 5,
    },
    {
      id: "demo-topic-bioenergetics",
      code: "Topic 6",
      title: "Plant structures and their functions",
      description: "Photosynthesis and how plants move water and sugars.",
      sort_order: 6,
    },
    {
      id: "demo-topic-organisation",
      code: "Topic 8",
      title: "Exchange and transport in animals",
      description: "Gas exchange, the blood, the heart and respiration.",
      sort_order: 8,
    },
  ],
  chemistry: [
    {
      id: "demo-topic-atomic",
      code: "Topic 1",
      title: "Atomic structure and the periodic table",
      description: "Atoms, isotopes and periodicity.",
      sort_order: 1,
    },
    {
      id: "demo-topic-bonding",
      code: "Topic 2",
      title: "Bonding, structure, and the properties of matter",
      description: "Ionic, covalent and metallic bonding.",
      sort_order: 2,
    },
    {
      id: "demo-topic-rates",
      code: "Topic 6",
      title: "The rate and extent of chemical change",
      description: "Measuring rates, collision theory and catalysts.",
      sort_order: 6,
    },
  ],
  physics: [
    {
      id: "demo-topic-electricity",
      code: "Topic 3",
      title: "Electricity",
      description: "Current, potential difference and circuits.",
      sort_order: 3,
    },
    {
      id: "demo-topic-energy",
      code: "Topic 7",
      title: "Energy",
      description: "Energy stores, transfers and efficiency.",
      sort_order: 7,
    },
  ],
};

export const DEMO_CURRICULUM_SPEC_POINTS: Record<string, SpecPoint[]> = {
  "demo-topic-cells": [
    {
      id: "demo-sp-cell-structure",
      topic_id: "demo-topic-cells",
      code: "EDEX 1.1",
      title: "Eukaryotic and Prokaryotic Cells",
      description: "Eukaryotic and prokaryotic cells and their sub-cellular structures.",
    },
    {
      id: "demo-sp-digestion",
      topic_id: "demo-topic-cells",
      code: "EDEX 1.12",
      title: "Enzymes as Biological Catalysts",
      description: "Enzymes and the products of digestion.",
    },
    {
      id: "demo-sp-transport",
      topic_id: "demo-topic-cells",
      code: "EDEX 1.15",
      title: "Active, Passive & Osmotic Transport",
      description: "Diffusion, osmosis and active transport.",
    },
    {
      id: "demo-sp-osmosis-practical",
      topic_id: "demo-topic-cells",
      code: "EDEX 1.16",
      title: "Core Practical – Osmosis in Potatoes",
      description:
        "Potato pieces in a range of sugar solutions, and the percentage change in mass.",
    },
  ],
  "demo-topic-cell-control": [
    {
      id: "demo-sp-cell-division",
      topic_id: "demo-topic-cell-control",
      code: "EDEX 2.1",
      title: "Mitosis and the Cell Cycle",
      description: "The cell cycle and the stages of mitosis.",
    },
  ],
  "demo-topic-infection": [
    {
      id: "demo-sp-pathogens",
      topic_id: "demo-topic-infection",
      code: "EDEX 5.4",
      title: "Pathogens & Infectious Agents",
      description: "Bacterial, viral, fungal and protist pathogens.",
    },
  ],
  "demo-topic-bioenergetics": [
    {
      id: "demo-sp-photosynthesis",
      topic_id: "demo-topic-bioenergetics",
      code: "EDEX 6.3",
      title: "Rate Limiting Factors on Photosynthesis",
      description: "How light intensity, CO₂ and temperature limit the rate.",
    },
  ],
  "demo-topic-organisation": [
    {
      id: "demo-sp-respiration",
      topic_id: "demo-topic-organisation",
      code: "EDEX 8.9",
      title: "Exothermic Respiration & Cellular Energy",
      description: "Respiration as an exothermic reaction that transfers energy in every cell.",
    },
  ],
  "demo-topic-atomic": [
    {
      id: "demo-sp-atoms",
      topic_id: "demo-topic-atomic",
      code: "AQA 4.1.1.5",
      title: "Size and mass of atoms",
      description: "Atomic structure, isotopes and relative atomic mass.",
    },
  ],
  "demo-topic-bonding": [
    {
      id: "demo-sp-ionic",
      topic_id: "demo-topic-bonding",
      code: "AQA 4.2.1.2",
      title: "Ionic bonding",
      description: "Electron transfer between metals and non-metals, and the ions it forms.",
    },
    {
      id: "demo-sp-covalent",
      topic_id: "demo-topic-bonding",
      code: "AQA 4.2.1.4",
      title: "Covalent bonding",
      description: "Shared pairs of electrons and simple molecules.",
    },
  ],
  "demo-topic-rates": [
    {
      id: "demo-sp-rates",
      topic_id: "demo-topic-rates",
      code: "AQA 4.6.1.3",
      title: "Collision theory and activation energy",
      description: "Collision frequency, activation energy and why each factor changes the rate.",
    },
  ],
  "demo-topic-electricity": [
    {
      id: "demo-sp-circuits",
      topic_id: "demo-topic-electricity",
      code: "OCR P3.2g",
      title: "Linear and non-linear components (I–V graphs)",
      description: "Resistance, V = IR and how components behave.",
    },
    {
      id: "demo-sp-series",
      topic_id: "demo-topic-electricity",
      code: "OCR P3.2i",
      title: "Resistance in series and parallel",
      description: "Current, potential difference and resistance in each kind of circuit.",
    },
  ],
  "demo-topic-energy": [
    {
      id: "demo-sp-energy-stores",
      topic_id: "demo-topic-energy",
      code: "OCR P7.1b",
      title: "How energy stores change in a system",
      description: "Kinetic, gravitational and elastic energy stores.",
    },
  ],
};

/** How long a lesson counts as running: `LIVE_TAIL_MS` in liveSessions.ts. */
const LESSON_MS = 90 * 60_000;

/**
 * A lesson on Alex's timetable, on `weekday` (0 Sunday … 6 Saturday) at a fixed
 * time on the viewer's clock: the next one that hasn't finished, or the last
 * one that has. Each subject has its own weekday evening, so the next lesson is
 * at most a week away (today's, if it is still to come or running), and the
 * last one ran within the seven days the Live page keeps.
 */
function lesson(weekday: number, hour: number, minute: number, which: "next" | "last"): string {
  const now = Date.now();
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  const finished = () => d.getTime() + LESSON_MS <= now;
  while (d.getDay() !== weekday || (which === "next" ? finished() : !finished())) {
    d.setDate(d.getDate() + (which === "next" ? 1 : -1));
  }
  return d.toISOString();
}

const TUESDAY = 2;
const WEDNESDAY = 3;
const THURSDAY = 4;

/** Demo spec points by id, as a live session lists them. */
const coveredPoints = (...ids: string[]) =>
  ids.map((id) => {
    const p = Object.values(DEMO_CURRICULUM_SPEC_POINTS)
      .flat()
      .find((sp) => sp.id === id)!;
    return { id: p.id, code: p.code, title: p.title };
  });

/**
 * One lesson a week per subject: Biology on Tuesdays at 17:30, Chemistry on
 * Wednesdays at 18:00 and Physics on Thursdays at 17:30. Each subject has its
 * next lesson booked and last week's in the history, and each lesson is on the
 * points that week's plan is on.
 */
export const DEMO_LIVE: DemoLive[] = [
  {
    id: "demo-live-1",
    kind: "live_session",
    title: "Biology: Exam Technique for 6-Mark Questions",
    description:
      "Live worked examples on structuring extended answers, using osmosis and limiting-factor questions.",
    subject: "biology",
    board: "edexcel",
    level: "gcse",
    starts_at: lesson(TUESDAY, 17, 30, "next"),
    join_url: "https://zoom.us/j/8500000001",
    specPoints: coveredPoints("demo-sp-transport", "demo-sp-photosynthesis"),
  },
  {
    id: "demo-live-5",
    kind: "live_session",
    title: "Biology: Cell Division & the Cell Cycle",
    description: "The stages in order, why DNA is copied first, and where stem cells are found.",
    subject: "biology",
    board: "edexcel",
    level: "gcse",
    starts_at: lesson(TUESDAY, 17, 30, "last"),
    join_url: null,
    specPoints: coveredPoints("demo-sp-cell-division"),
  },
  {
    id: "demo-live-2",
    kind: "live_session",
    title: "Chemistry: Ionic & Covalent Bonding",
    description: "Ions and shared pairs, and why structure decides melting point and conductivity.",
    subject: "chemistry",
    board: "aqa",
    level: "gcse",
    starts_at: lesson(WEDNESDAY, 18, 0, "next"),
    join_url: "https://zoom.us/j/8500000002",
    specPoints: coveredPoints("demo-sp-ionic", "demo-sp-covalent"),
  },
  {
    id: "demo-live-6",
    kind: "live_session",
    title: "Chemistry: Isotopes & Relative Atomic Mass",
    description: "Protons, neutrons and isotopes, then relative atomic mass step by step.",
    subject: "chemistry",
    board: "aqa",
    level: "gcse",
    starts_at: lesson(WEDNESDAY, 18, 0, "last"),
    join_url: null,
    specPoints: coveredPoints("demo-sp-atoms"),
  },
  {
    id: "demo-live-4",
    kind: "live_session",
    title: "Physics: Series & Parallel Circuits",
    description:
      "Current and potential difference in each kind of circuit, and the I–V graphs for your task.",
    subject: "physics",
    board: "ocr",
    level: "gcse",
    starts_at: lesson(THURSDAY, 17, 30, "next"),
    join_url: "https://zoom.us/j/8500000004",
    specPoints: coveredPoints("demo-sp-series", "demo-sp-circuits"),
  },
  {
    id: "demo-live-3",
    kind: "live_session",
    title: "Physics: Energy Stores Recap",
    description: "Kinetic, gravitational and elastic stores, and the equation for each.",
    subject: "physics",
    board: "ocr",
    level: "gcse",
    starts_at: lesson(THURSDAY, 17, 30, "last"),
    join_url: null,
    specPoints: coveredPoints("demo-sp-energy-stores"),
  },
];

/**
 * What is attached to each spec point: a real video, and the demo quiz and
 * homework written for it. Every id resolves — "Take" opens a DEMO_MCQ set and
 * "Open" a DEMO_HOMEWORK sheet — so nothing in the curriculum is a dead link.
 * The live sessions on each point are added below, from DEMO_LIVE.
 */
const CURRICULUM_CONTENT: Record<string, { resources: Resource[]; mcqSets: McqSet[] }> = {
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
        "Core Practical: Osmosis in Potatoes",
        "Method, results and percentage change in mass.",
        DEMO_YT.osmosis,
      ),
      demoHw("demo-hw-osmosis"),
    ],
    mcqSets: [quiz("demo-mcq-transport")],
  },
  // The osmosis task is written for both transport and the practical, so it
  // sits on both points, as a sheet linked to two points does live.
  "demo-sp-osmosis-practical": {
    resources: [
      demoVid(
        "demo-res-v-osmosis",
        "Core Practical: Osmosis in Potatoes",
        "Method, results and percentage change in mass.",
        DEMO_YT.osmosis,
      ),
      demoHw("demo-hw-osmosis"),
    ],
    mcqSets: [quiz("demo-mcq-osmosis-practical")],
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
    mcqSets: [quiz("demo-mcq-digestion")],
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
    mcqSets: [quiz("demo-mcq-pathogens")],
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
        "Core Practical: Rates of Photosynthesis",
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
    mcqSets: [quiz("demo-mcq-respiration")],
  },
  "demo-sp-atoms": {
    resources: [
      demoVid(
        "demo-res-v-atoms",
        "Elements, Isotopes & Relative Atomic Mass",
        "Protons, neutrons, electrons and isotopes.",
        DEMO_YT.isotopes,
      ),
      demoHw("demo-hw-atoms"),
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
      demoHw("demo-hw-bonding"),
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
      demoHw("demo-hw-covalent"),
    ],
    mcqSets: [quiz("demo-mcq-covalent")],
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
    mcqSets: [quiz("demo-mcq-rates")],
  },
  "demo-sp-energy-stores": {
    resources: [
      demoVid(
        "demo-res-v-energy",
        "Energy Stores: a Worked Example",
        "Following the energy through an arrow's flight.",
        DEMO_YT.energyStores,
      ),
      demoHw("demo-hw-energy"),
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
        "Practical: Lamps in Series & Parallel",
        "What happens to current and brightness in each circuit.",
        DEMO_YT.seriesParallel,
      ),
      demoHw("demo-hw-series"),
    ],
    mcqSets: [quiz("demo-mcq-series")],
  },
};

/**
 * The curriculum content above, with each live session listed on the points it
 * covers — the same links the Live page shows as "What's covered", so a point
 * and its lessons can't disagree.
 */
export const DEMO_CURRICULUM_CONTENT: Record<string, { resources: Resource[]; mcqSets: McqSet[] }> =
  Object.fromEntries(
    Object.entries(CURRICULUM_CONTENT).map(([pointId, content]) => [
      pointId,
      { ...content, resources: [...content.resources, ...liveOn(pointId)] },
    ]),
  );

/** Every demo spec point has bespoke content above; this only guards a missing key. */
export const DEMO_CURRICULUM_FALLBACK = (
  _point: SpecPoint,
): { resources: Resource[]; mcqSets: McqSet[] } => ({ resources: [], mcqSets: [] });
