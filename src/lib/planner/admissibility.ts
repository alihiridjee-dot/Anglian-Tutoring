import { isTeachBand, type PacingBand } from "./pacing";

/**
 * Admissibility — the one rule for "is this spec point allowed in this week?".
 *
 * The planner has two lanes and seven write sites, and until this module existed
 * each of them decided for itself what belonged in a week. Nothing anywhere
 * asked the question that matters most: *has the spine reached this topic yet?*
 *
 * It could not be asked from the review lane, because a review's own logic is
 * self-consistent — a point with assessed evidence has an FSRS card, a card
 * produces a next review, and the review is scheduled. Every step is correct.
 * The flaw is upstream: evidence can exist for a topic the student has not been
 * taught. A weekly quiz tagged across topics writes a score for every point it
 * touches ([[scheduleDal]] `assessmentPointScores`), so one quiz spanning topics
 * 3 and 6 hands those points cards, and from then on the queue revises material
 * the programme has not introduced. The student is told to revisit something
 * they have never met.
 *
 * So the rule lives here, once, and everything that admits a point imports it:
 * the projection that builds a week, the roadmap that reads saved weeks back,
 * the DAL that writes them, and the audit script that sweeps for violations.
 * Pure — no I/O, no Supabase — so it is testable and identical in every caller.
 *
 * Deliberately NOT a mastery, coverage or difficulty judgement. It answers one
 * question: may this point be *assigned* in this week, by this lane.
 */

/** Mirrors the `plan_point_origin` enum, structurally, to stay dependency-free. */
export type PointOrigin = "ai" | "student" | "tutor" | "carried_over" | "core" | "focus";

/**
 * Put in the week by a person rather than by the programme.
 *
 * Hand-picked points are exempt from the spine test on purpose: a tutor whose
 * student is doing topic 6 at school this term must be able to assign topic 6
 * today, and the docs already treat explicit carry/add-practice controls as
 * human overrides to spacing. They are not exempt from being on the right
 * course — see {@link admit}.
 */
export function isHandPicked(origin: PointOrigin): boolean {
  return origin === "student" || origin === "tutor";
}

/** The programme, not a person, chose this point. Subject to the full rule. */
export function isAutomatic(origin: PointOrigin): boolean {
  return !isHandPicked(origin);
}

/**
 * Why a point was refused. A closed union so every consumer — the roadmap
 * panel, the DAL's error, the audit report — names the same failure the same
 * way, and so a new reason cannot be added without every switch being revisited.
 */
export type RejectionReason =
  /** The spine does not reach this point's topic until a later week. */
  | "ahead-of-spine"
  /** Assigned as a review, but nothing has ever been assessed on it. */
  | "no-evidence"
  /** The week being planned is at or past the exam. */
  | "beyond-exam"
  /** The topic is not on this student's programme at all (wrong course). */
  | "off-course"
  /** The point has no topic — orphaned by a curriculum re-import. */
  | "orphaned";

/** Tutor-facing copy for a refusal. One sentence, no jargon, no blame. */
export function describeReason(reason: RejectionReason): string {
  switch (reason) {
    case "ahead-of-spine":
      return "the programme has not reached this topic yet";
    case "no-evidence":
      return "there is no assessed practice behind this review";
    case "beyond-exam":
      return "this week is at or past the exam date";
    case "off-course":
      return "this topic is not on the student's course";
    case "orphaned":
      return "this spec point no longer belongs to a topic";
  }
}

export interface Verdict {
  ok: boolean;
  reason?: RejectionReason;
}

const ADMITTED: Verdict = { ok: true };

/**
 * How far the spine has come, per topic: the Monday its teach band opens.
 *
 * Topic-level rather than point-level by choice. A teach band's start week is
 * stable — it lives in the acknowledged baseline and moves only when the exam
 * date does — whereas the division of a topic's points across the weeks of its
 * run is recomputed on every load ({@link splitAcrossWeeks}), so a point-level
 * test would refuse work mid-topic whenever the split shifted under it. "The
 * programme has started topic 3" is also what the question actually means.
 */
export function spineReach(bands: PacingBand[]): Map<string, string> {
  const reach = new Map<string, string>();
  for (const band of bands) {
    if (!isTeachBand(band)) continue;
    const current = reach.get(band.topicId);
    // Date-keys are YYYY-MM-DD, so a lexical compare is a chronological one.
    if (!current || band.startWeek < current) reach.set(band.topicId, band.startWeek);
  }
  return reach;
}

/** A point being considered for a week, in the shape every caller can supply. */
export interface AdmissionCandidate {
  specPointId: string;
  /** Null when the curriculum no longer places this point under a topic. */
  topicId: string | null;
  /** Which lane wants it. Defaults to `ai` — generated, lane unrecorded. */
  origin?: PointOrigin;
  /**
   * Whether assessed practice exists behind it. Only consulted for the review
   * lane; teaching a point for the first time is precisely the case with none.
   * Undefined means "not established", and is not treated as absence.
   */
  hasEvidence?: boolean;
  /**
   * Whether the point's topic is on the same subject/board/level as the plan.
   * Undefined means "not established" — most callers cannot answer it without
   * an extra read, and the `plan_point_admissible` trigger compares the three
   * enums directly, which is the authoritative test. Only an explicit `false`
   * refuses.
   */
  onCourse?: boolean;
}

export interface AdmissionContext {
  /** From {@link spineReach} over the live or baseline spine. */
  reach: Map<string, string>;
  /** Monday date-key of the week being planned. */
  weekStart: string;
  /** The programme's exam date, when known. */
  examDate?: string | null;
}

/**
 * May this point be assigned in this week?
 *
 * Order is load-bearing. Being on the right course, and being a real point at
 * all, are checked before the hand-picked exemption: a person may overrule the
 * *pace* of the programme, but not put another course's material — or a point
 * that no longer exists — into a student's week.
 */
export function admit(point: AdmissionCandidate, ctx: AdmissionContext): Verdict {
  if (!point.topicId) return { ok: false, reason: "orphaned" };
  if (point.onCourse === false) return { ok: false, reason: "off-course" };
  if (ctx.examDate && ctx.weekStart >= ctx.examDate) return { ok: false, reason: "beyond-exam" };

  const origin = point.origin ?? "ai";
  if (isHandPicked(origin)) return ADMITTED;

  /**
   * A topic the spine map has never heard of is *unproven*, not refused.
   *
   * `reach` is built from whichever spine the caller has. Against a live
   * recomputation it holds every topic on the course, so a miss cannot happen.
   * Against the stored `student_program_plan.pacing` it can: a topic added to
   * the curriculum after the programme was laid is not in that JSON yet, and a
   * baseline that predates a curriculum change is a reason to know nothing, not
   * a reason to refuse. Inferring "wrong course" from a spine-map miss also put
   * this module in direct disagreement with the `plan_point_admissible`
   * trigger, which allows exactly this case — two enforcement layers giving
   * opposite answers to the same question.
   *
   * Course membership is a separate fact, and callers who can establish it say
   * so via `onCourse`. The trigger compares the three enums directly, which is
   * the authoritative test; `plan_matches_enrolment` then checks the plan
   * itself against the student's enrolment, which is the case neither this
   * module nor the point-level trigger can see.
   */
  const opens = ctx.reach.get(point.topicId);
  if (opens && opens > ctx.weekStart) return { ok: false, reason: "ahead-of-spine" };

  // A review is a claim about something already practised. Teaching is not, so
  // the evidence test belongs to the focus lane alone.
  if (origin === "focus" && point.hasEvidence === false)
    return { ok: false, reason: "no-evidence" };

  return ADMITTED;
}

export interface Rejection<T> {
  point: T;
  reason: RejectionReason;
}

export interface Partitioned<T> {
  admitted: T[];
  rejected: Rejection<T>[];
}

/**
 * Split a set of points into what may be assigned and what may not, keeping the
 * caller's own richer objects intact. Refusals are returned rather than dropped:
 * the engine's convention is that impossible work is reported, never silently
 * discarded (see `docs/ASSESSMENT_SCHEDULER.md`).
 */
export function partition<T>(
  points: T[],
  read: (point: T) => AdmissionCandidate,
  ctx: AdmissionContext,
): Partitioned<T> {
  const admitted: T[] = [];
  const rejected: Rejection<T>[] = [];
  for (const point of points) {
    const verdict = admit(read(point), ctx);
    if (verdict.ok) admitted.push(point);
    else rejected.push({ point, reason: verdict.reason! });
  }
  return { admitted, rejected };
}

/**
 * Does this point carry a record of the student's own work?
 *
 * The dividing line for what happens to an inadmissible point. The immunity
 * rules in `save_weekly_plan` — done, carried, attempted — exist to protect
 * student work from a re-cut, not to pin a scheduling mistake in place
 * permanently, which is exactly what they were doing: a stale review the
 * student had ticked off was untouchable by every automatic path in the system
 * and could only be deleted by hand.
 *
 * So an inadmissible point with history is **quarantined** — kept, marked, and
 * excluded from the week's work and from review projection — while one without
 * history is simply dropped. Either way the engine can clear it on its own.
 */
export function hasStudentHistory(point: {
  done_at?: string | null;
  carried_from?: string | null;
  attempted?: boolean;
}): boolean {
  return !!point.done_at || !!point.carried_from || !!point.attempted;
}
