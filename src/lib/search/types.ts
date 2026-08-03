import type { ComponentType } from "react";
import type { SubjectV, BoardV, LevelV } from "@/lib/taxonomy";
import type { ProfileRole } from "@/hooks/data/useEnrolments";

/** The kinds of thing the global palette can turn up, in display order. */
export const SEARCH_GROUPS = [
  "page",
  "spec_point",
  "topic",
  "homework",
  "live_session",
  "video",
  "download",
  "mcq_set",
  "student",
] as const;

export type SearchGroup = (typeof SEARCH_GROUPS)[number];

export const GROUP_LABEL: Record<SearchGroup, string> = {
  page: "Pages",
  spec_point: "Specification points",
  topic: "Topics",
  homework: "Homework",
  live_session: "Live sessions",
  video: "Videos",
  download: "Downloads",
  mcq_set: "Quizzes",
  student: "Students",
};

/**
 * Where selecting a hit goes.
 *
 * `to` is a plain string rather than the router's literal route union: these
 * are assembled at runtime from data, so they can't be checked against the
 * route tree. Every value is produced inside `globalSearch.ts` from a fixed set
 * of routes, and the palette casts once at the single `navigate` call site.
 */
export interface SearchTarget {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
}

export interface SearchHit extends SearchTarget {
  /** Unique within a result set — group-prefixed, since ids repeat across tables. */
  key: string;
  group: SearchGroup;
  title: string;
  /** Short leading chip, e.g. a spec point code. */
  code?: string | null;
  /** Secondary line: the topic it sits under, a due date, a subject. */
  subtitle?: string | null;
  /** Right-aligned metadata chips, e.g. "Biology · AQA". */
  tags?: string[];
  icon: ComponentType<{ className?: string }>;
  /** Descending rank from `scoreRecord`. */
  score: number;
}

/**
 * Everything the search needs to know about who is asking.
 *
 * RLS is the actual authority on what a caller may read — this context exists
 * so results are also *useful*: a student's hits are narrowed to the subjects,
 * board and level they actually sit, so every result opens onto a page that
 * will really show it.
 */
export interface SearchContext {
  isTutor: boolean;
  role: ProfileRole | null;
  entitledSubjects: SubjectV[];
  boardBySubject: Record<string, BoardV | undefined>;
  level: LevelV | null;
  /** True inside the /demo/* showcase, where every read comes from fixtures. */
  isDemo: boolean;
  demoRole: "student" | "parent" | null;
}
