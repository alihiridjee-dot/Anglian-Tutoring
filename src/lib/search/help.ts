/**
 * The help half of the search box: what a student *means* when they type a
 * sentence like "help me find my mcq for this week".
 *
 * Two layers share the one list of intents below. The rules run on every
 * settled keystroke and cost nothing. When none of them fits, the student can
 * pick "Ask for help" and a model chooses an intent from the same list
 * (`helpAsk.functions.ts`). Either way the answer is the student's own data,
 * read through RLS by `helpAnswers.ts` — the model only ever chooses which
 * question is being asked, it never writes the answer.
 *
 * Pure on purpose: the server function imports this, so nothing here may touch
 * the browser client or React.
 */

export interface HelpIntent {
  id: string;
  /** The heading over the answer in the search box. */
  label: string;
  /** What the intent is for, in the words the model is shown. */
  describe: string;
  /** The words that select it, matched against the normalised query. */
  pattern: RegExp;
}

/**
 * In priority order: the first pattern that matches wins, so the more specific
 * request has to come before the one it overlaps ("my quiz marks" is about a
 * quiz, "my homework marks" is about grades).
 */
export const HELP_INTENTS = [
  {
    id: "week_quizzes",
    label: "Your quizzes this week",
    describe: "find this week's MCQ / multiple-choice quiz",
    pattern: /\b(mcqs?|quiz(zes|es)?|multiple choice|tests?)\b/,
  },
  {
    id: "grades",
    label: "Your grades",
    describe: "see marks, scores, grades or feedback on work already done",
    pattern: /\b(grades?|marks?|marked|scores?|results?|feedback)\b/,
  },
  {
    id: "week_tasks",
    label: "Your tasks this week",
    describe: "find this week's tasks or homework, or what is due",
    pattern: /\b(tasks?|homeworks?|hw|assignments?|worksheets?|due)\b/,
  },
  {
    id: "week_videos",
    label: "Your videos this week",
    describe: "find the videos to watch this week",
    pattern: /\b(videos?|watch|clips?)\b/,
  },
  {
    id: "next_live",
    label: "Your next live sessions",
    describe: "find the next live session, lesson, class or Zoom call",
    pattern: /\b(live|zoom|lessons?|sessions?|class(es)?|calls?)\b/,
  },
  {
    id: "notes",
    label: "Revision notes",
    describe: "find revision notes or the specification",
    pattern: /\b(notes?|revise|revision|revising|specification|syllabus)\b/,
  },
  {
    id: "messages",
    label: "Ask your tutor",
    describe: "message or ask their tutor a question",
    pattern: /\b(messages?|chat|inbox|tutor|teacher)\b/,
  },
  {
    id: "week_plan",
    label: "This week",
    describe: "see this week's plan or what to do next",
    pattern: /\b(plan|planner|this week|to ?do|what should i|what do i|schedule|timetable)\b/,
  },
  {
    id: "billing",
    label: "Billing",
    describe: "payments, subscription or billing",
    pattern: /\b(billing|bill|payments?|pay|subscription|subscribe|price|cost)\b/,
  },
  {
    id: "account",
    label: "Your account",
    describe: "change password, email, profile photo or settings, or sign out",
    pattern: /\b(password|email|profile|settings?|log ?out|sign ?out|account|avatar|photo)\b/,
  },
] as const satisfies readonly HelpIntent[];

export type HelpIntentId = (typeof HELP_INTENTS)[number]["id"];

const INTENT_IDS = new Set<string>(HELP_INTENTS.map((i) => i.id));

export const isHelpIntent = (id: unknown): id is HelpIntentId =>
  typeof id === "string" && INTENT_IDS.has(id);

export const helpIntent = (id: HelpIntentId) => HELP_INTENTS.find((i) => i.id === id)!;

/**
 * Lowercase, apostrophes dropped ("what's" → "whats"), other punctuation turned
 * to spaces. Dots and hyphens survive so a spec code like 4.1.2 still searches.
 */
function normalise(query: string): string {
  return query
    .toLowerCase()
    .replace(/[’'"]/g, "")
    .replace(/[^a-z0-9.\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first intent the query asks for, or null when it reads as a plain search. */
export function matchHelpIntent(query: string): HelpIntentId | null {
  const q = normalise(query);
  if (!q) return null;
  return HELP_INTENTS.find((i) => i.pattern.test(q))?.id ?? null;
}

/**
 * Words that carry no search meaning. "help me find my cell quiz" has to search
 * for "cell", not for all five words — a result must contain every term, so one
 * filler word is enough to empty the list.
 *
 * Kept to words no spec point is about: "current", "power" and "work" are
 * physics, so they stay searchable.
 */
const FILLER = new Set(
  (
    "a about after all am an and any are at be can cant could did do does dont find for " +
    "from get go got has have help hi how i im in is it its last let look looking me my " +
    "need next now of on open or our please pls see set show some the there this to " +
    "today tomorrow tonight want was we week weeks what whats when whens where wheres " +
    "which with you your"
  ).split(" "),
);

/** The query's terms without the filler, or all of them if nothing else is left. */
export function searchTerms(query: string): string[] {
  const all = normalise(query).split(" ").filter(Boolean);
  const kept = all.filter((t) => !FILLER.has(t));
  return kept.length ? kept : all;
}

/**
 * What is left to search for once a help answer has taken the request words.
 *
 * "help me find my mcq for this week" leaves nothing — the help answer is the
 * whole reply. "find my photosynthesis quiz" leaves "photosynthesis", which
 * still searches the specification beneath the answer.
 */
export function contentTerms(query: string, intent: HelpIntentId | null): string[] {
  if (!intent) return searchTerms(query);
  const pattern = helpIntent(intent).pattern;
  return normalise(query)
    .split(" ")
    .filter((t) => t && !FILLER.has(t) && !pattern.test(t));
}

/** Longest question sent to the model. A help request is a sentence, not an essay. */
export const MAX_QUESTION_LENGTH = 200;

/**
 * Takes out what we can spot of a student's contact details before the
 * question leaves for the model: email addresses and phone numbers. A name
 * typed in plain words cannot be told apart from a topic and still goes.
 */
export function scrubForModel(text: string): string {
  return text
    .slice(0, MAX_QUESTION_LENGTH)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/\+?\d[\d\s-]{8,}\d/g, "[number]")
    .trim();
}

/** What the model may answer: one of the intents, a search, or nothing fits. */
export type HelpReply =
  { intent: HelpIntentId } | { intent: "search"; topic: string } | { intent: "none" };

/**
 * Reads the model's JSON, trusting nothing in it. An intent outside the list, a
 * search with no usable words, or anything that isn't JSON at all comes back as
 * "none" — the student is pointed at their tutor rather than shown a guess.
 */
export function parseHelpReply(text: string): HelpReply {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { intent: "none" };
  }
  if (!raw || typeof raw !== "object") return { intent: "none" };
  const { intent, topic } = raw as { intent?: unknown; topic?: unknown };
  if (isHelpIntent(intent)) return { intent };
  if (intent === "search" && typeof topic === "string") {
    const words = searchTerms(topic).join(" ").slice(0, 60).trim();
    if (words) return { intent: "search", topic: words };
  }
  return { intent: "none" };
}
