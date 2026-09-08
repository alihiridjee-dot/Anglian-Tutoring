/**
 * Assessability — the rule for *why* a spec point has no mark, and what the
 * engine is entitled to conclude from that.
 *
 * The engine grades from graded evidence and nothing else, which is right. What
 * it could not do was distinguish the three ways a point ends up without any:
 *
 *  1. **Unassessable** — no quiz and no homework is tagged to the point, so
 *     there is nothing the student could have done. A gap in the library.
 *  2. **Awaiting** — material exists and the student has not done it. A gap in
 *     engagement, and the only one of the three that is about the student.
 *  3. **Assessed** — evidence exists; FSRS owns the point from here.
 *
 * All three used to render identically as `mastery = 0` ({@link pointMastery}
 * returns 0 for a null card), so a topic nobody had written a single question
 * for was displayed exactly like a topic the student had sat and failed. On the
 * course this was found on, 160 of 165 spec points had no quiz and no homework
 * at all — so "0%" was overwhelmingly a statement about the content library,
 * shown to the student as a statement about them.
 *
 * The distinction already existed one level down, in the weekly review's
 * `not_set` vs `not_done` ({@link statusOfPoint}), and stopped at the edge of a
 * single week. This lifts it to the point, the topic and the programme, where
 * the mastery figures actually live.
 *
 * Pure — no I/O — so the roadmap, the progress read and any audit agree.
 */

/** Why one spec point does or does not have a mark. */
export type PointAssessability =
  /** Graded evidence exists. */
  | "assessed"
  /** Practice exists and has not been done. */
  | "awaiting"
  /** No quiz and no homework is tagged to this point. */
  | "unassessable";

export function pointAssessability(point: {
  /** Any MCQ set or homework resource is tagged to this point. */
  hasMaterial: boolean;
  /** Any graded attempt or submission has landed on it. */
  hasEvidence: boolean;
}): PointAssessability {
  if (point.hasEvidence) return "assessed";
  return point.hasMaterial ? "awaiting" : "unassessable";
}

/** Student-facing copy. States a fact; never implies fault it cannot establish. */
export function describeAssessability(state: PointAssessability): string {
  switch (state) {
    case "assessed":
      return "marked from your practice";
    case "awaiting":
      return "there's practice set on this — it hasn't been done yet";
    case "unassessable":
      return "no practice has been written for this one yet";
  }
}

/** How a whole topic stands, once its points are counted. */
export type TopicAssessability =
  /** Every assessable point has evidence. */
  | "assessed"
  /** Some points assessed, some still waiting. */
  | "partial"
  /** Material exists across the topic and none of it has been done. */
  | "awaiting"
  /** Not one point in the topic has any practice attached. */
  | "unassessable";

export interface TopicAssessment {
  /** Spec points in the topic. */
  total: number;
  /** Points with any quiz or homework attached — the honest denominator. */
  assessable: number;
  /** Points with graded evidence behind them. */
  assessed: number;
  state: TopicAssessability;
  /**
   * Mean mastery across **assessed** points, or null when none are.
   *
   * Null rather than zero, and over assessed points rather than all of them.
   * Averaging a topic's two marked points against its fifteen unwritten ones
   * produces a number that moves when the library changes and not when the
   * student does, which is not a measure of anything. A caller that needs a
   * bar to draw should draw nothing, or draw {@link coveragePct}, and say which
   * it is.
   */
  masteryPct: number | null;
  /**
   * How much of the topic has been assessed at all, 0–100 — the progress
   * figure, as distinct from the performance one. Zero when nothing is
   * assessable, because none of it has been covered either.
   */
  coveragePct: number;
}

/**
 * Roll a topic's points up.
 *
 * A topic with no assessable points is `unassessable` and carries a null
 * mastery — the one case where the engine must decline to grade rather than
 * grade as zero. It is deliberately not treated as complete either: nothing has
 * been shown, so nothing is known, and `coveragePct` stays at 0.
 */
export function assessTopic(
  points: { state: PointAssessability; mastery: number }[],
): TopicAssessment {
  const total = points.length;
  const assessable = points.filter((p) => p.state !== "unassessable").length;
  const marked = points.filter((p) => p.state === "assessed");
  const assessed = marked.length;

  let state: TopicAssessability;
  if (assessable === 0) state = "unassessable";
  else if (assessed === 0) state = "awaiting";
  else if (assessed === assessable) state = "assessed";
  else state = "partial";

  return {
    total,
    assessable,
    assessed,
    state,
    masteryPct: assessed
      ? Math.round(marked.reduce((sum, p) => sum + p.mastery, 0) / assessed)
      : null,
    coveragePct: total > 0 ? Math.round((assessed / total) * 100) : 0,
  };
}

export interface AssessabilityStyle {
  label: string;
  /** What the label means, in the reader's words. */
  meaning: string;
  /** Kit tint, mixed against `--tint` by `.chip` — never a hand-picked colour. */
  tint: string;
}

export const TOPIC_ASSESSABILITY_STYLE: Record<TopicAssessability, AssessabilityStyle> = {
  assessed: {
    label: "Assessed",
    meaning: "every point with practice on it has been marked",
    tint: "tint-emerald",
  },
  partial: {
    label: "Part assessed",
    meaning: "some points are marked, others are still waiting",
    tint: "tint-primary",
  },
  awaiting: {
    label: "Not done yet",
    meaning: "there's practice on this topic that hasn't been done",
    tint: "tint-amber",
  },
  unassessable: {
    label: "No practice yet",
    meaning: "nothing has been written to test this topic — not your doing",
    tint: "tint-slate",
  },
};

/**
 * Is this topic's standing a statement about the student?
 *
 * The one question every surface showing a figure needs to ask before showing
 * it. False for `unassessable`, which is a statement about the library, and the
 * reason such a topic must never be rendered as a low score, counted in a
 * "topics covered" tally, or raised with the student as something they are
 * behind on.
 */
export function reflectsStudent(state: TopicAssessability): boolean {
  return state !== "unassessable";
}
