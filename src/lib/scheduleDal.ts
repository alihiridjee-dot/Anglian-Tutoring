import { supabase } from "@/integrations/supabase/client";
import { type SubjectV, type BoardV, type LevelV } from "./taxonomy";
import { type Json } from "@/integrations/supabase/types";
import {
  type Card,
  type Grade,
  type PointStatus,
  type ReviewSource,
  type Schedulable,
  SETTLED_THRESHOLD,
  applyReview,
  pointMastery,
  pointStatus,
  reviveCard,
  scoreToRating,
  selectForWeek,
} from "./planner/scheduler";

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
}
/** A topic's overall standing plus its per-point breakdown. */
export interface TopicProgress {
  topicId: string;
  title: string;
  points: ProgressPoint[];
  /** Mean mastery across the topic's points (0–100). */
  masteryPct: number;
  /** Enough mastery to count the topic as on-track on the roadmap. */
  settled: boolean;
  /** How many of its points have real homework/MCQ practice behind them. */
  practisedCount: number;
}

/** One review event before it's applied — used to replay history in time order. */
interface ReviewEvent {
  specPointId: string;
  rating: Grade;
  source: ReviewSource;
  scorePct: number | null;
  sourceId: string | null;
  reviewedAt: Date;
}

/**
 * Persistence for the spaced-repetition engine ([[scheduler]]).
 *
 * `student_spec_point_schedule` holds one FSRS card per (student, spec point);
 * `student_spec_point_reviews` is an append-only ledger whose (source, source_id)
 * key makes replaying a homework/MCQ result idempotent — the same attempt never
 * advances a card twice. All writes bind to the caller via RLS, except a tutor
 * may pass an explicit `studentId` (their policies allow writing a student's row).
 */
export class ScheduleDAL {
  /** FSRS cards for a set of spec points (revived to real Dates). */
  static async getSchedule(studentId: string, specPointIds: string[]): Promise<Map<string, Card>> {
    const out = new Map<string, Card>();
    if (specPointIds.length === 0) return out;
    const { data, error } = await supabase
      .from("student_spec_point_schedule")
      .select("spec_point_id, card")
      .eq("student_id", studentId)
      .in("spec_point_id", specPointIds);
    if (error) {
      console.error("Error loading schedule:", error);
      return out;
    }
    for (const r of data ?? []) out.set(r.spec_point_id, reviveCard(r.card));
    return out;
  }

  /** The student's confidence per spec point (null when never rated). */
  static async getConfidenceMap(
    studentId: string,
    specPointIds: string[],
  ): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    if (specPointIds.length === 0) return out;
    const { data } = await supabase
      .from("student_spec_point_confidence")
      .select("spec_point_id, confidence")
      .eq("student_id", studentId)
      .in("spec_point_id", specPointIds);
    for (const r of data ?? []) out.set(r.spec_point_id, r.confidence);
    return out;
  }

  /**
   * Record one review and advance the card. Idempotent: the ledger's
   * (student, point, source, source_id) key means a homework/MCQ result with a
   * stable `sourceId` is only ever applied once, while confidence/self-report
   * events (null `sourceId`) always count. Returns whether the card advanced.
   */
  static async recordReview(params: {
    studentId?: string;
    specPointId: string;
    rating: Grade;
    source: ReviewSource;
    scorePct?: number | null;
    sourceId?: string | null;
    reviewedAt?: Date;
  }): Promise<boolean> {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) throw new Error("Not signed in");
    const studentId = params.studentId ?? uid;
    const reviewedAt = params.reviewedAt ?? new Date();

    const { data: inserted, error } = await supabase
      .from("student_spec_point_reviews")
      .upsert(
        {
          student_id: studentId,
          spec_point_id: params.specPointId,
          rating: params.rating,
          source: params.source,
          score_pct: params.scorePct ?? null,
          source_id: params.sourceId ?? null,
          reviewed_at: reviewedAt.toISOString(),
        },
        { onConflict: "student_id,spec_point_id,source,source_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw error;
    if (!inserted || inserted.length === 0) return false; // already applied

    const existing = await this.getSchedule(studentId, [params.specPointId]);
    const next = applyReview(existing.get(params.specPointId) ?? null, params.rating, reviewedAt);
    const { error: upErr } = await supabase.from("student_spec_point_schedule").upsert(
      {
        student_id: studentId,
        spec_point_id: params.specPointId,
        card: next as unknown as Json,
        due: next.due.toISOString(),
        last_review: reviewedAt.toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id,spec_point_id" },
    );
    if (upErr) throw upErr;
    return true;
  }

  /**
   * Bring the schedule up to date with what the student has actually done:
   * every graded homework submission and MCQ attempt on these points becomes a
   * review (keyed by the submission/attempt id, so re-running is a no-op). Events
   * are replayed in chronological order so a strong-then-weak sequence lapses the
   * card correctly. Returns how many new reviews were applied.
   */
  static async syncReviewsFromAttempts(studentId: string, specPointIds: string[]): Promise<number> {
    if (specPointIds.length === 0) return 0;

    const [rsp, directRes, setsDirect, qTagged] = await Promise.all([
      supabase
        .from("resource_spec_points")
        .select("resource_id, spec_point_id, resources!inner(kind)")
        .in("spec_point_id", specPointIds),
      supabase
        .from("resources")
        .select("id, spec_point_id, kind")
        .in("spec_point_id", specPointIds),
      supabase.from("mcq_sets").select("id, spec_point_id").in("spec_point_id", specPointIds),
      supabase
        .from("mcq_questions")
        .select("set_id, spec_point_id")
        .in("spec_point_id", specPointIds),
    ]);

    const push = (m: Map<string, Set<string>>, key: string, point: string) => {
      const s = m.get(key) ?? new Set<string>();
      s.add(point);
      m.set(key, s);
    };
    const resourceToPoints = new Map<string, Set<string>>();
    for (const r of (rsp.data ?? []) as unknown as Array<{
      resource_id: string;
      spec_point_id: string;
      resources: { kind: string } | null;
    }>) {
      if (r.resources?.kind === "homework") push(resourceToPoints, r.resource_id, r.spec_point_id);
    }
    for (const r of (directRes.data ?? []) as Array<{
      id: string;
      spec_point_id: string | null;
      kind: string;
    }>) {
      if (r.kind === "homework" && r.spec_point_id) push(resourceToPoints, r.id, r.spec_point_id);
    }
    const setToPoints = new Map<string, Set<string>>();
    for (const r of (setsDirect.data ?? []) as Array<{
      id: string;
      spec_point_id: string | null;
    }>) {
      if (r.spec_point_id) push(setToPoints, r.id, r.spec_point_id);
    }
    for (const r of (qTagged.data ?? []) as Array<{
      set_id: string;
      spec_point_id: string | null;
    }>) {
      if (r.spec_point_id) push(setToPoints, r.set_id, r.spec_point_id);
    }

    const resourceIds = [...resourceToPoints.keys()];
    const setIds = [...setToPoints.keys()];
    const [subs, attempts] = await Promise.all([
      resourceIds.length
        ? supabase
            .from("homework_submissions")
            .select("id, resource_id, score_pct, graded_at, submitted_at")
            .eq("student_id", studentId)
            .in("resource_id", resourceIds)
        : Promise.resolve({ data: [] as HwRow[] }),
      setIds.length
        ? supabase
            .from("mcq_attempts")
            .select("id, set_id, score, total, created_at")
            .eq("user_id", studentId)
            .in("set_id", setIds)
        : Promise.resolve({ data: [] as AttemptRow[] }),
    ]);

    const events: ReviewEvent[] = [];
    for (const sub of (subs.data ?? []) as HwRow[]) {
      if (sub.score_pct == null) continue; // ungraded homework isn't a signal yet
      const pct = Math.round(Number(sub.score_pct));
      for (const p of resourceToPoints.get(sub.resource_id) ?? []) {
        events.push({
          specPointId: p,
          rating: scoreToRating(pct),
          source: "homework",
          scorePct: pct,
          sourceId: sub.id,
          reviewedAt: new Date(sub.graded_at ?? sub.submitted_at),
        });
      }
    }
    for (const a of (attempts.data ?? []) as AttemptRow[]) {
      if (!a.total) continue;
      const pct = Math.round(((a.score ?? 0) / a.total) * 100);
      for (const p of setToPoints.get(a.set_id) ?? []) {
        events.push({
          specPointId: p,
          rating: scoreToRating(pct),
          source: "mcq",
          scorePct: pct,
          sourceId: a.id,
          reviewedAt: new Date(a.created_at),
        });
      }
    }

    // Chronological replay so the card's stability/lapses reflect the real order.
    events.sort((x, y) => x.reviewedAt.getTime() - y.reviewedAt.getTime());
    let applied = 0;
    for (const e of events) {
      if (await this.recordReview({ studentId, ...e })) applied++;
    }
    return applied;
  }

  /**
   * The spec points a plan for the week ending `weekEnd` should lead with —
   * everything due (or never practised) ordered most-urgent first, capped at
   * `targetCount`. Deterministic (no AI), so it works locally and offline; the
   * AI suggester can still layer a rationale on top.
   */
  static async suggestForWeek(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    weekEnd: Date;
    targetCount?: number;
  }): Promise<string[]> {
    const { data: topics } = await supabase
      .from("topics")
      .select("id")
      .eq("subject", params.subject)
      .eq("board", params.board)
      .eq("level", params.level);
    const topicIds = (topics ?? []).map((t) => t.id);
    if (topicIds.length === 0) return [];

    const { data: pts } = await supabase
      .from("spec_points")
      .select("id, sort_order, topics!inner(sort_order)")
      .in("topic_id", topicIds);
    // Curriculum order so equal-priority ties (e.g. a student who's rated nothing
    // yet) fall in spec order rather than arbitrarily — selectForWeek's sort is
    // stable, so this ordering survives as the tie-breaker.
    const ids = ((pts ?? []) as unknown as CandidateRow[])
      .map((p) => ({ id: p.id, ts: p.topics?.sort_order ?? 0, ps: p.sort_order ?? 0 }))
      .sort((a, b) => a.ts - b.ts || a.ps - b.ps)
      .map((o) => o.id);
    if (ids.length === 0) return [];

    const [cards, conf] = await Promise.all([
      this.getSchedule(params.studentId, ids),
      this.getConfidenceMap(params.studentId, ids),
    ]);
    const items: Schedulable[] = ids.map((id) => ({
      specPointId: id,
      card: cards.get(id) ?? null,
      confidence: conf.get(id) ?? null,
    }));
    return selectForWeek(items, params.weekEnd, params.targetCount ?? 6);
  }

  /**
   * "Covered so far" — every spec point the student has actually practised
   * (has a homework or MCQ result on), with their best mark from each, grouped
   * by topic in curriculum order. Confidence-only ratings don't count as covered.
   * Drives the progress ledger under the termly confidence board.
   */
  static async getCoveredLedger(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
  }): Promise<CoveredTopic[]> {
    const { data: topics } = await supabase
      .from("topics")
      .select("id, title, sort_order")
      .eq("subject", params.subject)
      .eq("board", params.board)
      .eq("level", params.level);
    if (!topics || topics.length === 0) return [];
    const topicMeta = new Map(topics.map((t) => [t.id, t]));

    const { data: pts } = await supabase
      .from("spec_points")
      .select("id, code, title, sort_order, topic_id")
      .in(
        "topic_id",
        topics.map((t) => t.id),
      );
    if (!pts || pts.length === 0) return [];
    const pointMeta = new Map(pts.map((p) => [p.id, p]));

    const { data: reviews } = await supabase
      .from("student_spec_point_reviews")
      .select("spec_point_id, source, score_pct, reviewed_at")
      .eq("student_id", params.studentId)
      .in("source", ["homework", "mcq"])
      .in(
        "spec_point_id",
        pts.map((p) => p.id),
      );
    if (!reviews || reviews.length === 0) return [];

    const agg = new Map<string, { homework: number | null; quiz: number | null; last: string }>();
    const max = (a: number | null, b: number | null) =>
      b == null ? a : a == null ? b : Math.max(a, b);
    for (const r of reviews) {
      const cur = agg.get(r.spec_point_id) ?? { homework: null, quiz: null, last: r.reviewed_at };
      if (r.source === "homework") cur.homework = max(cur.homework, r.score_pct);
      else if (r.source === "mcq") cur.quiz = max(cur.quiz, r.score_pct);
      if (r.reviewed_at > cur.last) cur.last = r.reviewed_at;
      agg.set(r.spec_point_id, cur);
    }

    const byTopic = new Map<string, CoveredPoint[]>();
    for (const [pointId, a] of agg) {
      const meta = pointMeta.get(pointId);
      if (!meta) continue;
      const list = byTopic.get(meta.topic_id) ?? [];
      list.push({
        id: pointId,
        code: meta.code,
        title: meta.title,
        homeworkScore: a.homework,
        quizScore: a.quiz,
        lastReviewed: a.last,
      });
      byTopic.set(meta.topic_id, list);
    }

    return [...byTopic.entries()]
      .map(([topicId, points]) => ({
        topicId,
        title: topicMeta.get(topicId)?.title ?? "—",
        sort: topicMeta.get(topicId)?.sort_order ?? 0,
        points: points.sort((a, b) => {
          const pa = pointMeta.get(a.id)?.sort_order ?? 0;
          const pb = pointMeta.get(b.id)?.sort_order ?? 0;
          return pa - pb || a.code.localeCompare(b.code);
        }),
      }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ sort: _sort, ...t }) => t);
  }

  /**
   * The programme's per-topic standing: every topic with its spec points, each
   * carrying the student's confidence rating, best homework/quiz marks, and the
   * FSRS-derived status/mastery — so the roadmap can be expanded to show exactly
   * what's covered and how well. A topic is `settled` when its mean mastery
   * clears {@link SETTLED_THRESHOLD}; that's the "covered" signal the pacing uses,
   * and because confidence advances the same cards, the termly board feeds it
   * directly (while a flop pulls a topic back below the line).
   */
  static async getTopicProgress(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    now?: Date;
  }): Promise<TopicProgress[]> {
    const now = params.now ?? new Date();
    const { data: topics } = await supabase
      .from("topics")
      .select("id, title, sort_order")
      .eq("subject", params.subject)
      .eq("board", params.board)
      .eq("level", params.level);
    if (!topics || topics.length === 0) return [];

    const { data: pts } = await supabase
      .from("spec_points")
      .select("id, code, title, sort_order, topic_id")
      .in(
        "topic_id",
        topics.map((t) => t.id),
      );
    if (!pts || pts.length === 0) return [];
    const pointIds = pts.map((p) => p.id);

    const [cards, conf, marks] = await Promise.all([
      this.getSchedule(params.studentId, pointIds),
      this.getConfidenceMap(params.studentId, pointIds),
      this.getMarks(params.studentId, pointIds),
    ]);

    const byTopic = new Map<string, ProgressPoint[]>();
    for (const p of pts) {
      const card = cards.get(p.id) ?? null;
      const confidence = conf.get(p.id) ?? null;
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
        const masteryPct = points.length
          ? Math.round(points.reduce((s, p) => s + p.mastery, 0) / points.length)
          : 0;
        return {
          topicId: t.id,
          title: t.title,
          points,
          masteryPct,
          settled: masteryPct >= SETTLED_THRESHOLD,
          practisedCount: points.filter((p) => p.homeworkScore != null || p.quizScore != null)
            .length,
          _sort: t.sort_order ?? 0,
        };
      })
      .sort((a, b) => a._sort - b._sort)
      .map(({ _sort, ...t }) => t);
  }

  /** Best homework/quiz mark per spec point from the review ledger. */
  private static async getMarks(
    studentId: string,
    specPointIds: string[],
  ): Promise<Map<string, { homework: number | null; quiz: number | null }>> {
    const out = new Map<string, { homework: number | null; quiz: number | null }>();
    if (specPointIds.length === 0) return out;
    const { data: reviews } = await supabase
      .from("student_spec_point_reviews")
      .select("spec_point_id, source, score_pct")
      .eq("student_id", studentId)
      .in("source", ["homework", "mcq"])
      .in("spec_point_id", specPointIds);
    const max = (a: number | null, b: number | null) =>
      b == null ? a : a == null ? b : Math.max(a, b);
    for (const r of reviews ?? []) {
      const cur = out.get(r.spec_point_id) ?? { homework: null, quiz: null };
      if (r.source === "homework") cur.homework = max(cur.homework, r.score_pct);
      else if (r.source === "mcq") cur.quiz = max(cur.quiz, r.score_pct);
      out.set(r.spec_point_id, cur);
    }
    return out;
  }

  /**
   * "Retake this topic": pull every one of a topic's spec points back into the
   * current week's plan and mark their cards due now, so the topic's homework and
   * quizzes resurface and the programme treats it as needing another pass. Used
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
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
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

    // Mark each card due now so the roadmap/scheduler see the topic as pending
    // again. New (never-practised) points are already due, so only touch cards.
    const cards = await this.getSchedule(studentId, ids);
    const nowIso = new Date().toISOString();
    for (const [specPointId, card] of cards) {
      const due = { ...card, due: new Date() };
      await supabase.from("student_spec_point_schedule").upsert(
        {
          student_id: studentId,
          spec_point_id: specPointId,
          card: due as unknown as Json,
          due: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "student_id,spec_point_id" },
      );
    }
    return ids.length;
  }
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
type CandidateRow = {
  id: string;
  sort_order: number | null;
  topics: { sort_order: number | null } | null;
};
