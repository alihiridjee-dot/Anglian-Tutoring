/**
 * The showcase's guided tour: one route through the whole product, student side
 * then parent side.
 *
 * Each step names the page it lives on and the element it points at. The tour
 * moves between pages itself, so a visitor only ever presses Next. A step whose
 * element is missing still shows its card — it just has nothing to spotlight.
 */
export type TourStep = {
  path: string;
  /** CSS selector for the element to spotlight, or null for a centred card. */
  target: string | null;
  chapter: "Student" | "Parent";
  title: string;
  body: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    path: "/demo/student/dashboard",
    target: null,
    chapter: "Student",
    title: "Welcome to the demo",
    body: "This is Alex's account. Alex is a GCSE student taking Biology, Chemistry and Physics. Everything here is sample data, so click anything you like. Nothing is saved.",
  },
  {
    path: "/demo/student/dashboard",
    target: '[data-tour="welcome"]',
    chapter: "Student",
    title: "Each subject, its own exam board",
    body: "Alex sits Biology with Edexcel, Chemistry with AQA and Physics with OCR. Every topic, quiz and homework follows the right specification.",
  },
  {
    path: "/demo/student/dashboard",
    target: '[data-tour="live-banner"]',
    chapter: "Student",
    title: "Live lessons, counted down",
    body: "Small-group lessons run live on Zoom. The next one sits at the top of the dashboard, with a countdown and a join button.",
  },
  {
    path: "/demo/student/dashboard",
    target: '[data-tour="week-plan"]',
    chapter: "Student",
    title: "A plan for every week",
    body: "The planner turns the whole course into weekly work. New learning keeps to schedule, and anything that isn't sticking comes back for revision. Switch subject to see each plan.",
  },
  {
    path: "/demo/student/dashboard",
    target: '[data-tour="do-now"]',
    chapter: "Student",
    title: "What to do now",
    body: "The same week as a checklist. Every spec point has its video, quiz and homework one click away. Try pressing Play, or tick a point off.",
  },
  {
    path: "/demo/student/dashboard",
    target: '[data-tour="tutor-focus"]',
    chapter: "Student",
    title: "Extra focus from the tutor",
    body: "Tutors add their own focus for the week, with a short note on why it matters and the videos that go with it.",
  },
  {
    path: "/demo/student/planner",
    target: '[data-tour="roadmap"]',
    chapter: "Student",
    title: "The road to the exam",
    body: "Every topic is scheduled up to the exam, so the whole course is covered with time left to revise. Finished topics show how secure they are.",
  },
  {
    path: "/demo/student/curriculum",
    target: '[data-guide="curriculum-topics"]',
    chapter: "Student",
    title: "The whole specification",
    body: "Every topic and spec point on Alex's course. Open a topic, then a point, to find its videos, quizzes and homework in one place.",
  },
  {
    path: "/demo/student/mcqs",
    target: '[data-guide="page-content"] section.surface-loud',
    chapter: "Student",
    title: "Weekly MCQs",
    body: "A short quiz for each spec point on this week's plan. Older quizzes are filed by topic, with the best score kept.",
  },
  {
    path: "/demo/student/mcq/demo-mcq-transport",
    target: '[data-guide="page-content"] ol',
    chapter: "Student",
    title: "Try a quiz",
    body: "Pick an answer for each question, then press Submit. The quiz marks itself straight away and explains every answer.",
  },
  {
    path: "/demo/student/homework",
    target: '[data-guide="homework-grades"]',
    chapter: "Student",
    title: "Predicted grades",
    body: "Quiz and homework results add up to a predicted grade for each subject, on the 9–1 scale.",
  },
  {
    path: "/demo/student/homework/demo-hw-photosynthesis",
    target: '[data-guide="page-content"] .tint-emerald.premium-card',
    chapter: "Student",
    title: "Homework, marked with feedback",
    body: "Students answer homework on the page. Nothing to print or hand in. It comes back with a mark and written feedback from the tutor, question by question.",
  },
  {
    path: "/demo/student/live",
    target: '[data-guide="live-session"]',
    chapter: "Student",
    title: "Every live lesson in one place",
    body: "Upcoming lessons have their Zoom link and a WhatsApp reminder. Past lessons keep their recordings.",
  },
  {
    path: "/demo/student/messages",
    target: '[data-tour="messages"]',
    chapter: "Student",
    title: "Ask the tutor",
    body: "Stuck on something? Students message their tutor with the homework or quiz attached, so the tutor sees exactly what they mean.",
  },
  {
    path: "/demo/student/messages",
    target: '[data-guide="search"]',
    chapter: "Student",
    title: "Find anything",
    body: "Search every page, topic and quiz from here, or press ⌘K (Ctrl K on Windows).",
  },
  {
    path: "/demo/parent/dashboard",
    target: '[data-tour="parent-welcome"]',
    chapter: "Parent",
    title: "Now, the parent's view",
    body: "Parents have their own login. They follow their child's progress without needing to look over their shoulder.",
  },
  {
    path: "/demo/parent/dashboard",
    target: '[data-tour="parent-grades"]',
    chapter: "Parent",
    title: "Predicted grades",
    body: "The same predicted grades Alex sees, with the quiz and homework averages behind them.",
  },
  {
    path: "/demo/parent/dashboard",
    target: '[data-tour="parent-trends"]',
    chapter: "Parent",
    title: "Progress over time",
    body: "Weekly quiz averages for each subject, so parents can see the direction of travel, not just a single mark.",
  },
  {
    path: "/demo/parent/dashboard",
    target: '[data-tour="parent-engagement"]',
    chapter: "Parent",
    title: "Attendance and homework",
    body: "How many live lessons were attended and how much homework was handed in.",
  },
  {
    path: "/demo/parent/dashboard",
    target: '[data-tour="parent-feedback"]',
    chapter: "Parent",
    title: "The tutor's feedback",
    body: "Every comment the tutor writes on marked homework, in one list.",
  },
  {
    path: "/demo/parent/dashboard",
    target: null,
    chapter: "Parent",
    title: "That's the tour",
    body: "You've seen the whole platform. Keep exploring the demo, or join now to get started.",
  },
];

/** sessionStorage key holding the current step index while a tour is running. */
export const TOUR_KEY = "demo-tour-step";

/** Fired on the window when a tour starts, so an already-mounted tour picks it up. */
export const START_EVENT = "demo-tour:start";

export function readStep(): number | null {
  try {
    const raw = sessionStorage.getItem(TOUR_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n < TOUR_STEPS.length ? n : null;
  } catch {
    return null;
  }
}

export function writeStep(n: number | null) {
  try {
    if (n === null) sessionStorage.removeItem(TOUR_KEY);
    else sessionStorage.setItem(TOUR_KEY, String(n));
  } catch {
    // Storage refused (private mode): the tour still runs, it just won't
    // survive a reload.
  }
}

/**
 * Starts the guided tour from the first step. The caller navigates to the first
 * step's page if it isn't already on it.
 */
export function startDemoTour() {
  writeStep(0);
  window.dispatchEvent(new Event(START_EVENT));
}

export const TOUR_START_PATH = TOUR_STEPS[0].path;
