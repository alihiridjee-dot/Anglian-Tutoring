import { supabase } from "@/integrations/supabase/client";
import { type SubjectV, type BoardV, type LevelV } from "./taxonomy";
import { type Json } from "@/integrations/supabase/types";
import {
  type Card,
  type Grade,
  type PointStatus,
  type ReviewSource,
  SETTLED_THRESHOLD,
  applyReview,
  pointMastery,
  pointStatus,
  isDueBy,
  isFirstContact,
  retrievability,
  reviewEligibleAt,
  scoreToRating,
} from "./planner/scheduler";
import { weightOf } from "./planner/pacing";
import { readCourseSnapshot, type CourseSnapshot } from "./planner/readModels";
import {
  assessablePoints,
  mapAttemptSources,
  sourcesFromRows,
  type AttemptSources,
} from "./planner/attemptSources";
import {
  assessTopic,
  pointAssessability,
  type PointAssessability,
  type TopicAssessment,
} from "./planner/assessability";
import { selectIn, selectInSafe, selectInHistory } from "./db/chunked";
import { getSessionUserId } from "@/lib/auth/session";

/** One covered spec point, with how it went, for the "covered so far" ledger. */
export interface CoveredPoint {
  id: string;
  code: string;
  title: string;
  homeworkScore: number | null;
  quizScore: number | null;
  lastReviewed: string;
}
/** Covered points grouped under their topic. */
export interface CoveredTopic {
  topicId: string;
  title: string;
  points: CoveredPoint[];
}

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

/** One course's memory snapshot for the planner dashboard. */
export interface MemoryStats {
  /** Spec points in the course. */
  total: number;
  /** Never practised — no card yet. */
  newCount: number;
  /** Practised and due right now. */
  dueNow: number;
  /** Practised, due within the next 7 days. */
  dueThisWeek: number;
  /** Practised, not due for over a week — holding. */
  stable: number;
  /** Mean FSRS retrievability across practised points (0–1), null if none. */
  avgRetention: number | null;
  /** The three practised points closest to being forgotten. */
  weakest: { code: string; title: string; retention: number }[];
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
  /** FSRS cards for a set of spec points (revived to real Dates). */
  static async getSchedule(studentId: string, specPointIds: string[]): Promise<Map<string, Card>> {
    const { events } = await this.assessmentEvents(studentId, specPointIds);
    const cards = new Map<string, Card>();
    for (const row of foldReviews(events, new Map(), new Set()))
      cards.set(row.specPointId, row.card);
    return cards;
  }

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
  private static async assessmentEvents(
    studentId: string,
    ids: string[],
    snapshot?: CourseSnapshot | null,
  ): Promise<{ events: ReviewEvent[]; sources: AttemptSources }> {
    const empty: AttemptSources = {
      resourceToPoints: new Map(),
      setToPoints: new Map(),
      setScope: new Map(),
    };
    if (!ids.length) return { events: [], sources: empty };
    const sources = snapshot ? sourcesFromRows(snapshot.sources) : await mapAttemptSources(ids);
    const { resourceToPoints, setToPoints, setScope } = sources;
    const requestedIds = new Set(ids);
    const [subs, attempts] = snapshot
      ? [snapshot.submissions, snapshot.attempts]
      : await Promise.all([
          selectInHistory<HwRow>([...resourceToPoints.keys()], (batch, after) => {
            const query = supabase
              .from("homework_submissions")
              .select("id, resource_id, score_pct, graded_at, submitted_at")
              .eq("student_id", studentId)
              .in("resource_id", batch)
              .order("id")
              .limit(500);
            return after ? query.gt("id", after) : query;
          }),
          selectInHistory<AttemptRow>([...setToPoints.keys()], (batch, after) => {
            const query = supabase
              .from("mcq_attempts")
              .select("id, set_id, score, total, created_at")
              .eq("user_id", studentId)
              .in("set_id", batch)
              .order("id")
              .limit(500);
            return after ? query.gt("id", after) : query;
          }),
        ]);
    const snapshots = snapshot
      ? snapshot.attempts.map((a) => ({ id: a.id, point_scores: a.point_scores }))
      : await selectInSafe<{ id: string; point_scores: Json | null }>(
          attempts.map((a) => a.id),
          (batch) =>
            // Column is introduced by the assessment-snapshot migration. Before rollout,
            // only safely single-point aggregate attempts remain eligible evidence.
            supabase.from("mcq_attempts").select("id, point_scores").in("id", batch) as never,
          (message) => {
            if (!/point_scores.*does not exist|Could not find.*point_scores/i.test(message))
              throw new Error(message);
          },
        );
    const byAttempt = new Map(snapshots.map((a) => [a.id, a.point_scores]));
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
          reviewedAt: new Date(sub.graded_at ?? sub.submitted_at),
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

  /**
   * "Covered so far" — every spec point the student has actually practised
   * (has a homework or MCQ result on), with their best mark from each, grouped
   * by topic in curriculum order. Confidence-only ratings don't count as covered.
   * Drives the practice-history ledger.
   */
  static async getCoveredLedger(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    progress?: TopicProgress[];
  }): Promise<CoveredTopic[]> {
    const progress = params.progress ?? (await this.getTopicProgress(params));
    return progress
      .map((t) => ({
        topicId: t.topicId,
        title: t.title,
        points: t.points
          .filter((p) => p.lastReviewedAt && (p.homeworkScore != null || p.quizScore != null))
          .map((p) => ({
            id: p.id,
            code: p.code,
            title: p.title,
            homeworkScore: p.homeworkScore,
            quizScore: p.quizScore,
            lastReviewed: p.lastReviewedAt!,
          })),
      }))
      .filter((t) => t.points.length > 0);
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
    const now = params.now ?? new Date();
    const snapshot = await readCourseSnapshot(params);
    const { data: topics, error: topicsError } = snapshot
      ? { data: snapshot.topics, error: null }
      : await supabase
          .from("topics")
          .select("id, title, sort_order")
          .eq("subject", params.subject)
          .eq("board", params.board)
          .eq("level", params.level);
    if (topicsError) throw topicsError;
    if (!topics || topics.length === 0) return [];

    const pts =
      snapshot?.points ??
      (await selectIn<{
        id: string;
        code: string;
        title: string;
        sort_order: number | null;
        topic_id: string;
        weight: number | null;
      }>(
        topics.map((t) => t.id),
        (batch) =>
          supabase
            .from("spec_points")
            .select("id, code, title, sort_order, topic_id, weight")
            .in("topic_id", batch),
      ));
    const pointIds = pts.map((p) => p.id);

    // Read-only reconstruction also serves parent/tutor views without requiring
    // a write permission or mutating historical confidence records.
    const { events: evidence, sources } = await this.assessmentEvents(
      params.studentId,
      pointIds,
      snapshot,
    );
    // Which points anything could have marked, independent of whether it did.
    const assessable = assessablePoints(sources);
    const cards = new Map<string, Card>();
    for (const row of foldReviews(evidence, new Map(), new Set()))
      cards.set(row.specPointId, row.card);
    const marks = await this.getMarks(params.studentId, pointIds, evidence);

    const byTopic = new Map<string, ProgressPoint[]>();
    for (const p of pts) {
      const card = cards.get(p.id) ?? null;
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
        status: pointStatus(card, now),
        mastery: pointMastery(card, confidence, now),
        stability: card && !isFirstContact(card) ? card.stability : null,
        weight: weightOf(p),
        card,
        dueAt: card?.due.toISOString() ?? null,
        eligibleAt: card ? reviewEligibleAt(card).toISOString() : null,
        lastReviewedAt: card?.last_review?.toISOString() ?? null,
        reps: card?.reps ?? 0,
        retention: retrievability(card, now),
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

  /**
   * The planner dashboard's memory snapshot for one course: how many spec
   * points sit in each scheduling bucket, and how well the practised ones are
   * held right now (mean FSRS retrievability). One pass over the same cards the
   * scheduler plans from, so the panel can never disagree with the plan.
   */
  static async getMemoryStats(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    now?: Date;
    progress?: TopicProgress[];
  }): Promise<MemoryStats> {
    const now = params.now ?? new Date();
    const empty: MemoryStats = {
      total: 0,
      newCount: 0,
      dueNow: 0,
      dueThisWeek: 0,
      stable: 0,
      avgRetention: null,
      weakest: [],
    };
    const progress = params.progress ?? (await this.getTopicProgress(params));
    const pts = progress.flatMap((t) => t.points);
    const weekEnd = new Date(now.getTime() + 7 * 86_400_000);
    const stats = { ...empty, total: pts.length };
    const retained: number[] = [];
    const held: { code: string; title: string; retention: number }[] = [];
    for (const p of pts) {
      const card = p.card;
      const r = retrievability(card, now);
      if (r === null) {
        stats.newCount++;
        continue;
      }
      retained.push(r);
      held.push({ code: p.code, title: p.title, retention: r });
      if (isDueBy(card, now)) stats.dueNow++;
      else if (isDueBy(card, weekEnd)) stats.dueThisWeek++;
      else stats.stable++;
    }
    if (retained.length > 0) {
      stats.avgRetention = retained.reduce((s, r) => s + r, 0) / retained.length;
      // Only points actually decaying belong here — a just-reviewed card sits at
      // ~100% and "closest to slipping: 100%" is noise, not a warning.
      stats.weakest = held
        .filter((h) => h.retention < 0.9)
        .sort((a, b) => a.retention - b.retention)
        .slice(0, 3);
    }
    return stats;
  }

  /** Best homework/quiz mark per spec point from graded source records. */
  private static async getMarks(
    studentId: string,
    specPointIds: string[],
    evidence?: ReviewEvent[],
  ): Promise<Map<string, { homework: number | null; quiz: number | null }>> {
    const out = new Map<string, { homework: number | null; quiz: number | null }>();
    if (specPointIds.length === 0) return out;
    const reviews = (evidence ?? (await this.assessmentEvents(studentId, specPointIds)).events).map(
      (e) => ({
        spec_point_id: e.specPointId,
        source: e.source,
        score_pct: e.scorePct,
      }),
    );
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

  /**
   * "Retake this topic": pull every one of a topic's spec points back into the
   * current week's plan as an explicit practice request. It never changes memory. Used
   * by the "covered so far" ledger. Returns how many points were resurfaced.
   */
  static async resurfaceTopic(params: {
    studentId?: string;
    topicId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    weekStart: string;
  }): Promise<number> {
    const uid = await getSessionUserId();
    if (!uid) throw new Error("Not signed in");
    const studentId = params.studentId ?? uid;

    const { data: pts } = await supabase
      .from("spec_points")
      .select("id")
      .eq("topic_id", params.topicId);
    const ids = (pts ?? []).map((p) => p.id);
    if (ids.length === 0) return 0;

    // Add them to this week's plan (create the plan if there isn't one yet).
    const { WeeklyPlanDAL } = await import("./weeklyPlanDal");
    const existing = await WeeklyPlanDAL.getPlan(studentId, params.subject, params.weekStart);
    if (existing) {
      await WeeklyPlanDAL.addPoints(existing.plan.id, ids, "carried_over");
    } else {
      await WeeklyPlanDAL.savePlan({
        subject: params.subject,
        board: params.board,
        level: params.level,
        weekStart: params.weekStart,
        specPointIds: ids,
        source: "student",
        origin: "carried_over",
        studentId,
      });
    }

    // An explicit practice request changes the assignment, not the memory model.
    return ids.length;
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
  if (scope.size === 1 && !scope.has("__unattributed__") && total && score != null) {
    out.set([...scope][0], Math.max(0, Math.min(100, (score / total) * 100)));
  }
  return out;
}

type HwRow = {
  id: string;
  resource_id: string;
  score_pct: number | null;
  graded_at: string | null;
  submitted_at: string;
};
type AttemptRow = {
  id: string;
  set_id: string;
  score: number | null;
  total: number | null;
  created_at: string;
};
