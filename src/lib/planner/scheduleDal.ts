import { type SubjectV, type BoardV, type LevelV } from "../curriculum/taxonomy";
import {
  type Card,
  type Grade,
  type PointStatus,
  type ReviewSource,
  SETTLED_THRESHOLD,
  applyReview,
  pointMastery,
  pointStatus,
  isFirstContact,
  retrievability,
  reviewEligibleAt,
  scoreToRating,
} from "./scheduler";
import { weightOf } from "./pacing";
import { SubjectPauseDAL, type PauseRecord } from "./pausesDal";
import { pausedMsSince } from "./pauseTime";
import { BreakDAL } from "./breaksDal";
import { backOn, type StudentBreak } from "./breaks";
import { weekKeyToDate } from "./week";
import { readCourseSnapshot, type CourseSnapshot } from "./readModels";
import { assessablePoints, sourcesFromRows, type AttemptSources } from "./attemptSources";
import {
  assessTopic,
  pointAssessability,
  type PointAssessability,
  type TopicAssessment,
} from "./assessability";

/** One spec point's standing for the programme's expandable topic breakdown. */
export interface ProgressPoint {
  id: string;
  code: string;
  title: string;
  confidence: number | null;
  homeworkScore: number | null;
  quizScore: number | null;
  status: PointStatus;
  mastery: number;
  /**
   * FSRS memory strength in days — how long the point is expected to hold.
   * Null when never practised.
   */
  stability: number | null;
  /** Its share of a week's work — see `spec_points.weight`. 1 when unmeasured. */
  weight: number;
  card: Card | null;
  dueAt: string | null;
  eligibleAt: string | null;
  lastReviewedAt: string | null;
  reps: number;
  retention: number | null;
  /**
   * Why this point does or does not have a mark — see [[assessability]].
   * `unassessable` means nothing has been written to test it, which is a
   * statement about the library and must never be rendered as a low score.
   */
  assessability: PointAssessability;
}
/** A topic's overall standing plus its per-point breakdown. */
export interface TopicProgress {
  topicId: string;
  title: string;
  points: ProgressPoint[];
  /**
   * Mean mastery across the topic's **assessed** points (0–100), 0 when none.
   *
   * Callers must consult {@link assessment} before rendering this: on a topic
   * with no assessable points the figure is not a low score, it is the absence
   * of one, and `assessment.masteryPct` is null to say so. Kept non-null here
   * only so existing consumers keep type-checking.
   */
  masteryPct: number;
  /** Every point has an assessed mark of at least 70%. */
  settled: boolean;
  /** How many of its points have real homework/MCQ practice behind them. */
  practisedCount: number;
  /** Assessed / awaiting / unassessable counts and state — see [[assessability]]. */
  assessment: TopicAssessment;
}

/** One review event before it's applied — used to replay history in time order. */
export interface ReviewEvent {
  specPointId: string;
  rating: Grade;
  source: ReviewSource;
  scorePct: number | null;
  sourceId: string | null;
  reviewedAt: Date;
}

/** The ledger's idempotency key for one event. */
export function reviewKey(e: {
  specPointId: string;
  source: string;
  sourceId: string | null;
}): string {
  return `${e.specPointId}|${e.source}|${e.sourceId ?? ""}`;
}

/**
 * Replay a run of review events against a set of cards, in time order.
 *
 * Events already present in the ledger are dropped rather than re-applied:
 * `record_reviews_atomic` skips them server-side (that is what makes a replay
 * idempotent), so folding one would advance the card for a review the database
 * is about to ignore. Pure, so the batched path can be checked against the
 * one-request-per-event path it replaces.
 */
export function foldReviews(
  events: ReviewEvent[],
  cards: Map<string, Card>,
  alreadyApplied: ReadonlySet<string>,
): { specPointId: string; card: Card; event: ReviewEvent }[] {
  const ordered = [...events]
    .filter(
      (e) =>
        e.source !== "confidence" &&
        Number.isFinite(e.reviewedAt.getTime()) &&
        Number.isInteger(e.rating) &&
        e.rating >= 1 &&
        e.rating <= 4,
    )
    .sort(
      (x, y) =>
        x.reviewedAt.getTime() - y.reviewedAt.getTime() || reviewKey(x).localeCompare(reviewKey(y)),
    );
  const working = new Map(cards);
  const seen = new Set(alreadyApplied);
  const out: { specPointId: string; card: Card; event: ReviewEvent }[] = [];
  for (const e of ordered) {
    const key = reviewKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    const next = applyReview(working.get(e.specPointId) ?? null, e.rating, e.reviewedAt, {
      countsAsLapse: e.source !== "confidence",
    });
    working.set(e.specPointId, next);
    out.push({ specPointId: e.specPointId, card: next, event: e });
  }
  return out;
}

/** Reconstruct derived memory from graded source evidence; never trust stored client cards. */
export class ScheduleDAL {
  /**
   * Canonical assessed history. Replayed on read: no destructive migration,
   * no stale confidence cards, and corrected/late marks take their proper place.
   *
   * Returns the source map alongside the events because it has already built it
   * and it answers a question the events cannot: which points have practice
   * attached *at all*. A point with no events and no material is a hole in the
   * library; one with no events and material waiting is a student who has not
   * done it. See [[assessability]].
   */
  private static assessmentEvents(
    ids: string[],
    snapshot: CourseSnapshot,
  ): { events: ReviewEvent[]; sources: AttemptSources } {
    const empty: AttemptSources = {
      resourceToPoints: new Map(),
      setToPoints: new Map(),
      setScope: new Map(),
    };
    if (!ids.length) return { events: [], sources: empty };
    const sources = sourcesFromRows(snapshot.sources);
    const { resourceToPoints, setScope } = sources;
    const requestedIds = new Set(ids);
    const subs = snapshot.submissions;
    const attempts = snapshot.attempts;
    const byAttempt = new Map(attempts.map((a) => [a.id, a.point_scores]));
    const events: ReviewEvent[] = [];
    for (const sub of subs) {
      if (sub.score_pct == null || !Number.isFinite(Number(sub.score_pct))) continue;
      const pct = Math.max(0, Math.min(100, Number(sub.score_pct)));
      for (const point of resourceToPoints.get(sub.resource_id) ?? [])
        events.push({
          specPointId: point,
          rating: scoreToRating(pct),
          source: "homework",
          scorePct: pct,
          sourceId: sub.id,
          // The memory clock starts when the student did the work, not when
          // it was marked: a task marked days later was not revised days later.
          reviewedAt: new Date(sub.submitted_at),
        });
    }
    for (const attempt of attempts) {
      const scores = assessmentPointScores(
        byAttempt.get(attempt.id),
        setScope.get(attempt.set_id) ?? new Set(),
        attempt.score,
        attempt.total,
      );
      for (const [point, pct] of scores) {
        if (!requestedIds.has(point)) continue;
        events.push({
          specPointId: point,
          rating: scoreToRating(pct),
          source: "mcq",
          scorePct: pct,
          sourceId: attempt.id,
          reviewedAt: new Date(attempt.created_at),
        });
      }
    }
    return { events, sources };
  }

  /** Assessed marks and reconstructed memory per point. A topic is settled
   * only when every point has a homework or quiz mark of at least 70%. */
  static async getTopicProgress(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    now?: Date;
  }): Promise<TopicProgress[]> {
    const [snapshot, pauses, breaks] = await Promise.all([
      readCourseSnapshot(params),
      SubjectPauseDAL.history(params.studentId, params.subject),
      BreakDAL.list(params.studentId),
    ]);
    return this.progressFrom({ ...params, snapshot, pauses, breaks });
  }

  /** {@link getTopicProgress} from reads already made ([[courseState]] makes them in one trip). */
  static async progressFrom(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    snapshot: CourseSnapshot;
    /** The subject's recorded stops, oldest first. */
    pauses: PauseRecord[];
    /** The student's breaks that stand. */
    breaks: StudentBreak[];
    now?: Date;
  }): Promise<TopicProgress[]> {
    const now = params.now ?? new Date();
    const { snapshot } = params;
    const topics = snapshot.topics;
    if (!topics || topics.length === 0) return [];

    const pts = snapshot.points;
    const pointIds = pts.map((p) => p.id);

    // Read-only reconstruction also serves parent/tutor views without requiring
    // a write permission or mutating historical confidence records.
    const { events: evidence, sources } = this.assessmentEvents(pointIds, snapshot);
    // Which points anything could have marked, independent of whether it did.
    const assessable = assessablePoints(sources);
    const cards = new Map<string, Card>();
    for (const row of foldReviews(evidence, new Map(), new Set()))
      cards.set(row.specPointId, row.card);
    const marks = this.getMarks(pointIds, evidence);
    // Paused time doesn't count. A review's clock stops while its subject is
    // stopped, so a pause never comes back as a pile of overdue reviews.
    const spans = [
      ...params.pauses.map((r) => ({
        start: new Date(r.startedAt),
        end: r.endedAt ? new Date(r.endedAt) : null,
      })),
      // A break stops it too. Once over, a break is recorded in the history
      // above; until then it is read from the booking.
      ...params.breaks
        .filter((b) => !b.recordedAt)
        .map((b) => ({ start: weekKeyToDate(b.startsOn), end: weekKeyToDate(backOn(b)) })),
    ];

    const byTopic = new Map<string, ProgressPoint[]>();
    for (const p of pts) {
      const card = cards.get(p.id) ?? null;
      const paused = card ? pausedMsSince(spans, card.last_review, now) : 0;
      const at = paused ? new Date(now.getTime() - paused) : now;
      const confidence = null;
      const m = marks.get(p.id);
      const list = byTopic.get(p.topic_id) ?? [];
      list.push({
        id: p.id,
        code: p.code,
        title: p.title,
        confidence,
        homeworkScore: m?.homework ?? null,
        quizScore: m?.quiz ?? null,
        status: pointStatus(card, at),
        mastery: pointMastery(card, confidence, at),
        stability: card && !isFirstContact(card) ? card.stability : null,
        weight: weightOf(p),
        card,
        dueAt: card ? new Date(card.due.getTime() + paused).toISOString() : null,
        eligibleAt: card ? new Date(reviewEligibleAt(card).getTime() + paused).toISOString() : null,
        lastReviewedAt: card?.last_review?.toISOString() ?? null,
        reps: card?.reps ?? 0,
        retention: retrievability(card, at),
        assessability: pointAssessability({
          hasMaterial: assessable.has(p.id),
          // A mark, not a card: a point can hold an FSRS card only because
          // something graded it, so these agree, and the mark is the fact.
          hasEvidence: m?.homework != null || m?.quiz != null,
        }),
      });
      byTopic.set(p.topic_id, list);
    }
    const sortOf = new Map(pts.map((p) => [p.id, p.sort_order ?? 0]));

    return topics
      .map((t) => {
        const points = (byTopic.get(t.id) ?? []).sort(
          (a, b) =>
            (sortOf.get(a.id) ?? 0) - (sortOf.get(b.id) ?? 0) || a.code.localeCompare(b.code),
        );
        const assessment = assessTopic(
          points.map((p) => ({ state: p.assessability, mastery: p.mastery })),
        );
        return {
          topicId: t.id,
          title: t.title,
          points,
          masteryPct: assessment.masteryPct ?? 0,
          assessment,
          settled:
            points.length > 0 &&
            points.every(
              (p) => Math.max(p.homeworkScore ?? -1, p.quizScore ?? -1) >= SETTLED_THRESHOLD,
            ),
          practisedCount: points.filter((p) => p.homeworkScore != null || p.quizScore != null)
            .length,
          _sort: t.sort_order ?? 0,
        };
      })
      .sort((a, b) => a._sort - b._sort || a.topicId.localeCompare(b.topicId))
      .map(({ _sort, ...t }) => t);
  }

  /** Best homework/quiz mark per spec point from graded source records. */
  private static getMarks(
    specPointIds: string[],
    evidence: ReviewEvent[],
  ): Map<string, { homework: number | null; quiz: number | null }> {
    const out = new Map<string, { homework: number | null; quiz: number | null }>();
    if (specPointIds.length === 0) return out;
    const reviews = evidence.map((e) => ({
      spec_point_id: e.specPointId,
      source: e.source,
      score_pct: e.scorePct,
    }));
    const max = (a: number | null, b: number | null) =>
      b == null ? a : a == null ? b : Math.max(a, b);
    for (const r of reviews) {
      const cur = out.get(r.spec_point_id) ?? { homework: null, quiz: null };
      if (r.source === "homework") cur.homework = max(cur.homework, r.score_pct);
      else if (r.source === "mcq") cur.quiz = max(cur.quiz, r.score_pct);
      out.set(r.spec_point_id, cur);
    }
    return out;
  }
}

/** Only immutable per-point results or genuinely single-point aggregates qualify. */
export function assessmentPointScores(
  snapshot: unknown,
  scope: ReadonlySet<string>,
  score: number | null,
  total: number | null,
): Map<string, number> {
  const out = new Map<string, number>();
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    for (const [point, value] of Object.entries(snapshot)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100)
        out.set(point, value);
    }
    return out;
  }
  // A score or total that isn't a real number (NaN, Infinity) gives no score at all.
  if (
    scope.size === 1 &&
    !scope.has("__unattributed__") &&
    score != null &&
    total != null &&
    Number.isFinite(score) &&
    Number.isFinite(total) &&
    total > 0
  ) {
    out.set([...scope][0], Math.max(0, Math.min(100, (score / total) * 100)));
  }
  return out;
}
