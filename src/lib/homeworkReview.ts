import { BOARDS, LEVELS, SUBJECTS, type BoardV, type LevelV, type SubjectV } from "@/lib/taxonomy";

/**
 * The rules behind the tutor's Homework & Grades tab, kept apart from the
 * components so they can be tested without rendering anything.
 *
 * Two queues live here. *Outgoing* is generated sheets waiting at the review
 * gate; *incoming* is handed-in work whose marks a tutor may correct before
 * they publish. Both are filtered entirely in memory — the working set of
 * either is bounded by a week, and a filter that answers in the same frame is
 * the whole point of the screen.
 */

// ─── URL state ──────────────────────────────────────────────────────────────

export type SheetStatus = "to_review" | "approved" | "held";
/**
 * The tabs over the outgoing table. `to_review` is two different jobs: a sheet
 * students cannot open yet can still be fixed before anyone sees it, and one
 * that is already out is being read after the fact. One tab for both hid which
 * was which.
 */
export type SheetSegment = "upcoming" | "live" | "held" | "approved";
export type MarkStatus = "pending" | "edited" | "finalized";
export type GradesView = "outgoing" | "incoming";

/**
 * Everything the tab remembers, as it appears in the address bar. Multi-select
 * filters are comma-separated so a filtered queue is one short, shareable link.
 * Nothing here names a student: `student` and `sub` are row ids, never names.
 */
export type GradesSearch = {
  view?: GradesView;
  subject?: string;
  level?: string;
  tier?: string;
  board?: string;
  sheets?: SheetSegment;
  sheet?: string;
  group?: string;
  status?: MarkStatus;
  student?: string;
  sub?: string;
};

const SHEET_SEGMENTS: SheetSegment[] = ["upcoming", "live", "held", "approved"];
const MARK_STATUSES: MarkStatus[] = ["pending", "edited", "finalized"];
const text = (v: unknown) => (typeof v === "string" && v.length <= 200 && v ? v : undefined);
const oneOf = <T extends string>(v: unknown, all: readonly T[]) =>
  all.includes(v as T) ? (v as T) : undefined;

export function validateGradesSearch(search: Record<string, unknown>): GradesSearch {
  return {
    view: oneOf(search.view, ["outgoing", "incoming"] as const),
    subject: text(search.subject),
    level: text(search.level),
    tier: text(search.tier),
    board: text(search.board),
    sheets: oneOf(search.sheets, SHEET_SEGMENTS),
    sheet: text(search.sheet),
    group: text(search.group),
    status: oneOf(search.status, MARK_STATUSES),
    student: text(search.student),
    sub: text(search.sub),
  };
}

export const parseSet = (csv: string | undefined): Set<string> =>
  new Set((csv ?? "").split(",").filter(Boolean));

/** Flip one value in a comma-separated set; an empty set is `undefined`, so it leaves the URL. */
export function toggleInCsv(csv: string | undefined, value: string): string | undefined {
  const set = parseSet(csv);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return set.size ? [...set].sort().join(",") : undefined;
}

// ─── Outgoing: sheets at the gate ───────────────────────────────────────────

export type Sheet = {
  id: string;
  title: string;
  subject: SubjectV;
  board: BoardV | null;
  level: LevelV;
  /** From the topic the sheet's spec point belongs to; most topics have none. */
  tier: string | null;
  specCode: string | null;
  topicTitle: string | null;
  specPointId: string | null;
  status: SheetStatus;
  publishAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  questionCount: number;
  totalMarks: number;
  /** Work already handed in against this sheet — what makes an edit risky. */
  submissionCount: number;
};

export type SheetFilters = Pick<GradesSearch, "subject" | "level" | "tier" | "board">;
export type FacetKey = keyof SheetFilters;

/** A sheet with no tier or board still has to be findable, so "none" is a value. */
export const NONE = "none";
/**
 * What a filter reads off a row. Sheets have all four; handed-in work carries
 * its sheet's subject, level and board, and a missing value counts as "none".
 */
export type Course = { [K in FacetKey]?: string | null };
const facetValue = (s: Course, key: FacetKey): string => s[key] ?? NONE;

const LABELS: Record<string, string> = Object.fromEntries(
  [...SUBJECTS, ...BOARDS, ...LEVELS].map((o) => [o.value, o.label]),
);
/** Short enough for a table cell; the full names are for forms. */
const SHORT: Record<string, string> = { gcse_trilogy: "Trilogy", igcse: "iGCSE", [NONE]: "None" };
export const facetLabel = (value: string): string =>
  SHORT[value] ??
  LABELS[value] ??
  (value.length <= 2 ? value.toUpperCase() : value[0].toUpperCase() + value.slice(1));

export function matchesSheetFilters(s: Course, f: SheetFilters, skip?: FacetKey): boolean {
  for (const key of ["subject", "level", "tier", "board"] as const) {
    if (key === skip) continue;
    const chosen = parseSet(f[key]);
    if (chosen.size && !chosen.has(facetValue(s, key))) return false;
  }
  return true;
}

export type Facet = { value: string; label: string; count: number };

/**
 * The options for one filter row, each with how many sheets it would show.
 *
 * A facet's counts ignore its own selection and respect every other one — so
 * with Physics chosen, the Board row says how many *Physics* sheets each board
 * has, and the Subject row still shows what picking Biology as well would add.
 * Subject, level and board list the whole taxonomy, in its order, whatever the
 * data holds: a queue that is all Edexcel GCSE has to *say* so, and a zero
 * beside iGCSE is the answer to "where are the iGCSE sheets?". Tier comes from
 * the data, because most topics have none — when nothing varies it has one
 * option and the caller can leave it out.
 */
const TAXONOMY: Partial<Record<FacetKey, readonly { value: string }[]>> = {
  subject: SUBJECTS,
  level: LEVELS,
  board: BOARDS,
};

export function facetsFor(sheets: Course[], f: SheetFilters, key: FacetKey): Facet[] {
  const counts = new Map<string, number>((TAXONOMY[key] ?? []).map((o) => [o.value, 0]));
  for (const s of sheets) {
    const v = facetValue(s, key);
    if (!counts.has(v)) counts.set(v, 0);
    if (matchesSheetFilters(s, f, key)) counts.set(v, counts.get(v)! + 1);
  }
  const facets = [...counts].map(([value, count]) => ({ value, label: facetLabel(value), count }));
  // Insertion order is already taxonomy order; only a data-led row needs sorting.
  if (!TAXONOMY[key]) facets.sort((a, b) => a.label.localeCompare(b.label));
  return facets.sort((a, b) => Number(a.value === NONE) - Number(b.value === NONE));
}

export type SheetFlag = "live" | "thin" | "answered";

/**
 * What makes a sheet worth reading before the others. Every flag is a fact
 * about the row, not a guess about its quality:
 *  - live:     students can already open it and no tutor has read it
 *  - thin:     fewer than three questions came back from the generator
 *  - answered: work has been handed in, so changing marks would shift a grade
 */
export function sheetFlags(s: Sheet, now = Date.now()): SheetFlag[] {
  const flags: SheetFlag[] = [];
  if (s.status === "to_review" && isLive(s, now)) flags.push("live");
  if (s.questionCount < 3) flags.push("thin");
  if (s.submissionCount > 0) flags.push("answered");
  return flags;
}

export const isLive = (s: Pick<Sheet, "status" | "publishAt">, now = Date.now()): boolean =>
  s.status === "approved" ||
  (s.status === "to_review" && (!s.publishAt || new Date(s.publishAt).getTime() <= now));

export const segmentOf = (
  s: Pick<Sheet, "status" | "publishAt">,
  now = Date.now(),
): SheetSegment => (s.status === "to_review" ? (isLive(s, now) ? "live" : "upcoming") : s.status);

/** Live-and-unread first, then whatever publishes soonest. */
export function sortForReview(sheets: Sheet[], now = Date.now()): Sheet[] {
  const rank = (s: Sheet) => (sheetFlags(s, now).includes("live") ? 0 : 1);
  return [...sheets].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.publishAt ?? "").localeCompare(b.publishAt ?? "") ||
      a.title.localeCompare(b.title),
  );
}

/** "17h", "2d 4h", "12 min" — the time left before something happens by itself. */
export function timeLeft(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const mins = Math.ceil((new Date(iso).getTime() - now) / 60_000);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// ─── Incoming: marks to check ───────────────────────────────────────────────

export type MarkRow = {
  graded_at: string | null;
  tutor_reviewed_at: string | null;
};

/**
 * Pending — marked by the model, untouched by a person.
 * Edited — a tutor saved corrections but has not published them.
 * Finalized — published, by a tutor or by the clock.
 */
export function markStatusOf(s: MarkRow): MarkStatus {
  if (s.graded_at) return "finalized";
  return s.tutor_reviewed_at ? "edited" : "pending";
}

/**
 * Forgiving name search: every typed word must start some word of the name, or
 * appear inside it. "ai k" finds "Aisha Khan"; so does "khan a".
 */
export function matchesName(name: string, query: string): boolean {
  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = name.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => words.some((w) => w.startsWith(part)) || lower.includes(part));
}

/** A cohort that follows from enrolment alone: one course, one group. */
export const cohortId = (subject: string, board: string, level: string | null) =>
  `cohort:${subject}:${board}:${level ?? NONE}`;
export const cohortLabel = (subject: string, board: string, level: string | null) =>
  [facetLabel(board), level ? facetLabel(level) : null, facetLabel(subject)]
    .filter(Boolean)
    .join(" ");
