import { STRONG_THRESHOLD } from "@/lib/planner/coverage";
import { toSciNotation } from "@/lib/platform/sciNotation";
import type { SubjectV } from "@/lib/curriculum/taxonomy";

// Suggested questions in a student's "Ask your tutor" box: the spec points
// they did worst on lately, each with a question they could send about it.
// Kept pure so the server function and its tests agree on the rules.

/** How many suggestions the box offers. */
export const MAX_IDEAS = 3;

/** Longest question shown; a longer reply is a model rambling, not a question. */
export const MAX_IDEA_LENGTH = 160;

/** One mark on a spec point: a quiz attempt's share of it, or a task's mark. */
export interface PointMark {
  specPointId: string;
  pct: number;
  /** When it was scored, as the database gives it. */
  at: string;
}

/** A suggestion as the box shows it. */
export interface QuestionIdea {
  specPointId: string;
  subject: SubjectV;
  code: string;
  /** The spec point's title, which becomes the thread's subject line. */
  topic: string;
  question: string;
}

/**
 * The spec points the student did badly on, worst first.
 *
 * Judged on each point's newest mark, so a topic they have since put right
 * drops out. Below {@link STRONG_THRESHOLD} counts as badly, the same bar the
 * planner uses for "shaky".
 */
export function weakestPoints(marks: readonly PointMark[], limit = MAX_IDEAS): string[] {
  const latest = new Map<string, { pct: number; at: number }>();
  for (const m of marks) {
    const at = Date.parse(m.at);
    if (!Number.isFinite(m.pct) || !Number.isFinite(at)) continue;
    const seen = latest.get(m.specPointId);
    if (!seen || at > seen.at) latest.set(m.specPointId, { pct: m.pct, at });
  }
  return [...latest]
    .filter(([, m]) => m.pct < STRONG_THRESHOLD)
    .sort(([, a], [, b]) => a.pct - b.pct || b.at - a.at)
    .slice(0, limit)
    .map(([id]) => id);
}

/**
 * The model's questions, one slot per topic sent and in the same order.
 *
 * Anything that isn't a usable one-line question becomes null and that topic
 * is simply not suggested; a reply that isn't the JSON asked for gives none.
 */
export function parseIdeasReply(text: string, count: number): (string | null)[] {
  const out: (string | null)[] = Array.from({ length: count }, () => null);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return out;
  }
  const list = (raw as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) return out;
  for (let i = 0; i < count; i++) {
    const q = list[i];
    if (typeof q !== "string") continue;
    const clean = q
      .replace(/\s+/g, " ")
      .replace(/^["'“‘]+|["'”’]+$/g, "")
      .trim();
    if (clean.length >= 8 && clean.length <= MAX_IDEA_LENGTH) out[i] = toSciNotation(clean);
  }
  return out;
}
