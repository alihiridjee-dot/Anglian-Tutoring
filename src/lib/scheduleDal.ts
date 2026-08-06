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
  confidenceToRating,
  pointMastery,
  pointStatus,
  isDueBy,
  isFirstContact,
  retrievability,
  reviveCard,
  scoreToRating,
  selectForWeek,
} from "./planner/scheduler";
import { type WeekLane } from "./planner/pacing";
import { mapAttemptSources } from "./planner/attemptSources";
import { selectInSafe } from "./db/chunked";
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
   *
   * Carried alongside `mastery` because the two answer different questions and
   * mastery alone can't order a topic: it is anchored on the confidence rating,
   * so a student who rates a topic uniformly scores every point in it
   * identically. Stability still separates them, and it's what "closest to being
   * forgotten" actually means.
   */
  stability: number | null;
  /** Its share of a week's work — see `spec_points.weight`. 1 when unmeasured. */
  weight: number;
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

/** `record_reviews_atomic` rejects an array longer than this. */
const RPC_REVIEW_LIMIT = 500;

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
  const ordered = [...events].sort((x, y) => x.reviewedAt.getTime() - y.reviewedAt.getTime());
  const working = new Map(cards);
  const out: { specPointId: string; card: Card; event: ReviewEvent }[] = [];
  for (const e of ordered) {
    if (alreadyApplied.has(reviewKey(e))) continue;
    const next = applyReview(working.get(e.specPointId) ?? null, e.rating, e.reviewedAt, {
      countsAsLapse: e.source !== "confidence",
    });
    working.set(e.specPointId, next);
    out.push({ specPointId: e.specPointId, card: next, event: e });
  }
  return out;
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
    const rows = await selectInSafe<{ spec_point_id: string; card: Json }>(
      specPointIds,
      (batch) =>
        supabase
          .from("student_spec_point_schedule")
          .select("spec_point_id, card")
          .eq("student_id", studentId)
          .in("spec_point_id", batch),
      (m) => console.error("Error loading schedule:", m),
    );
    for (const r of rows) out.set(r.spec_point_id, reviveCard(r.card));
    return out;
  }

  /** The student's confidence per spec point (null when never rated). */
  static async getConfidenceMap(
    studentId: string,
    specPointIds: string[],
  ): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    if (specPointIds.length === 0) return out;
    const rows = await selectInSafe<{ spec_point_id: string; confidence: number }>(
      specPointIds,
      (batch) =>
        supabase
          .from("student_spec_point_confidence")
          .select("spec_point_id, confidence")
          .eq("student_id", studentId)
          .in("spec_point_id", batch),
    );
    for (const r of rows) out.set(r.spec_point_id, r.confidence);
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
    const uid = await getSessionUserId();
    if (!uid) throw new Error("Not signed in");
    const studentId = params.studentId ?? uid;
    const reviewedAt = params.reviewedAt ?? new Date();

    const existing = await this.getSchedule(studentId, [params.specPointId]);
    // A self-rating is a report, not a failed recall — it never lapses the card.
    const next = applyReview(existing.get(params.specPointId) ?? null, params.rating, reviewedAt, {
      countsAsLapse: params.source !== "confidence",
    });

    // Ledger insert + card upsert happen inside one DB transaction, so an
    // interruption can't strand a ledger row whose card never advanced (the
    // dedupe key would then skip that attempt forever).
    const { data: applied, error } = await supabase.rpc("record_reviews_atomic", {
      _reviews: [
        {
          student_id: studentId,
          spec_point_id: params.specPointId,
          rating: params.rating,
          source: params.source,
          score_pct: params.scorePct ?? null,
          source_id: params.sourceId ?? null,
          reviewed_at: reviewedAt.toISOString(),
          card: next as unknown as Json,
          due: next.due.toISOString(),
        },
      ] as unknown as Json,
    });
    if (error) throw error;
    return ((applied as unknown as string[]) ?? []).length > 0;
  }

  /**
   * Record one confidence self-rating across a whole set of spec points in three
   * round-trips (ledger insert, card read, card upsert) rather than three per
   * point. Used when the termly board's topic drag re-rates every point under a
   * topic at once. Confidence reviews carry no source_id, so they always insert.
   */
  static async recordConfidenceReviews(specPointIds: string[], confidence: number): Promise<void> {
    if (specPointIds.length === 0) return;
    const uid = await getSessionUserId();
    if (!uid) throw new Error("Not signed in");
    const rating = confidenceToRating(confidence);
    const now = new Date();
    const nowIso = now.toISOString();

    const cards = await this.getSchedule(uid, specPointIds);
    // One transactional RPC for the whole batch: every ledger row and card
    // upsert commits together or not at all (confidence rows have no source_id,
    // so they always insert — same semantics as before).
    const { error } = await supabase.rpc("record_reviews_atomic", {
      _reviews: specPointIds.map((id) => {
        // Self-ratings never lapse the card — see applyReview.
        const next = applyReview(cards.get(id) ?? null, rating, now, { countsAsLapse: false });
        return {
          student_id: uid,
          spec_point_id: id,
          rating,
          source: "confidence",
          score_pct: null,
          source_id: null,
          reviewed_at: nowIso,
          card: next as unknown as Json,
          due: next.due.toISOString(),
        };
      }) as unknown as Json,
    });
    if (error) throw error;
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

    const { resourceToPoints, setToPoints } = await mapAttemptSources(specPointIds);

    const resourceIds = [...resourceToPoints.keys()];
    const setIds = [...setToPoints.keys()];
    const [subs, attempts] = await Promise.all([
      selectInSafe<HwRow>(resourceIds, (batch) =>
        supabase
          .from("homework_submissions")
          .select("id, resource_id, score_pct, graded_at, submitted_at")
          .eq("student_id", studentId)
          .in("resource_id", batch),
      ),
      selectInSafe<AttemptRow>(setIds, (batch) =>
        supabase
          .from("mcq_attempts")
          .select("id, set_id, score, total, created_at")
          .eq("user_id", studentId)
          .in("set_id", batch),
      ),
    ]);

    const events: ReviewEvent[] = [];
    for (const sub of subs) {
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
    for (const a of attempts) {
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

    if (events.length === 0) return 0;

    // Chronological replay so the card's stability/lapses reflect the real order.
    events.sort((x, y) => x.reviewedAt.getTime() - y.reviewedAt.getTime());

    // This used to call recordReview once per event, and each call was two round
    // trips (read the card, then the RPC). A student with a term of marks behind
    // them could sit through hundreds of sequential requests on every planner
    // load — and this runs on the hot path, for every student at once.
    //
    // The replay is folded in memory instead, then written in one transaction.
    // Getting that right needs the ledger first: the RPC skips a review it has
    // already seen (that is what makes replays idempotent), so folding an
    // already-applied attempt would advance the card a second time. Reading the
    // existing keys up front and dropping those events keeps the outcome
    // identical to the one-at-a-time version.
    const seen = new Set(
      (
        await selectInSafe<{ spec_point_id: string; source: string; source_id: string | null }>(
          specPointIds,
          (batch) =>
            supabase
              .from("student_spec_point_reviews")
              .select("spec_point_id, source, source_id")
              .eq("student_id", studentId)
              .in("source", ["homework", "mcq"])
              .in("spec_point_id", batch),
        )
      ).map((r) => `${r.spec_point_id}|${r.source}|${r.source_id ?? ""}`),
    );

    const pending = events.filter((e) => !seen.has(reviewKey(e)));
    if (pending.length === 0) return 0;

    const cards = await this.getSchedule(studentId, [
      ...new Set(pending.map((e) => e.specPointId)),
    ]);
    const rows = foldReviews(events, cards, seen).map(({ card, event: e }) => ({
      student_id: studentId,
      spec_point_id: e.specPointId,
      rating: e.rating,
      source: e.source,
      score_pct: e.scorePct ?? null,
      source_id: e.sourceId ?? null,
      reviewed_at: e.reviewedAt.toISOString(),
      card: card as unknown as Json,
      due: card.due.toISOString(),
    }));

    // The RPC refuses more than 500 rows per call.
    let applied = 0;
    for (let i = 0; i < rows.length; i += RPC_REVIEW_LIMIT) {
      const { data, error } = await supabase.rpc("record_reviews_atomic", {
        _reviews: rows.slice(i, i + RPC_REVIEW_LIMIT) as unknown as Json,
      });
      if (error) throw error;
      applied += ((data as unknown as string[]) ?? []).length;
    }
    return applied;
  }

  /**
   * The spec points a plan for the week ending `weekEnd` should lead with —
   * everything due (or never practised) ordered most-urgent first, capped at
   * `targetCount`. Deterministic (no AI), so it works locally and offline; the
   * AI suggester can still layer a rationale on top.
   *
   * Each pick comes back with the lane it belongs in, decided by
   * {@link isFirstContact}: a point the student has never met is new material,
   * not revision. This is the planner of last resort — it runs only when the
   * programme has no bands for the week — and it used to hand every point back
   * unlabelled, which the caller then filed wholesale as revision.
   */
  static async suggestForWeek(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    weekEnd: Date;
    targetCount?: number;
  }): Promise<{ specPointIds: string[]; lanes: Record<string, WeekLane> }> {
    const empty = { specPointIds: [], lanes: {} };
    const { data: topics } = await supabase
      .from("topics")
      .select("id")
      .eq("subject", params.subject)
      .eq("board", params.board)
      .eq("level", params.level);
    const topicIds = (topics ?? []).map((t) => t.id);
    if (topicIds.length === 0) return empty;

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
    if (ids.length === 0) return empty;

    const [cards, conf] = await Promise.all([
      this.getSchedule(params.studentId, ids),
      this.getConfidenceMap(params.studentId, ids),
    ]);
    const items: Schedulable[] = ids.map((id) => ({
      specPointId: id,
      card: cards.get(id) ?? null,
      confidence: conf.get(id) ?? null,
    }));
    const specPointIds = selectForWeek(items, params.weekEnd, params.targetCount ?? 6);
    const lanes: Record<string, WeekLane> = {};
    for (const id of specPointIds) {
      lanes[id] = isFirstContact(cards.get(id) ?? null) ? "core" : "focus";
    }
    return { specPointIds, lanes };
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

    const pts = await selectInSafe<{
      id: string;
      code: string;
      title: string;
      sort_order: number | null;
      topic_id: string;
    }>(
      topics.map((t) => t.id),
      (batch) =>
        supabase
          .from("spec_points")
          .select("id, code, title, sort_order, topic_id")
          .in("topic_id", batch),
    );
    if (pts.length === 0) return [];
    const pointMeta = new Map(pts.map((p) => [p.id, p]));

    const reviews = await selectInSafe<{
      spec_point_id: string;
      source: string;
      score_pct: number | null;
      reviewed_at: string;
    }>(
      pts.map((p) => p.id),
      (batch) =>
        supabase
          .from("student_spec_point_reviews")
          .select("spec_point_id, source, score_pct, reviewed_at")
          .eq("student_id", params.studentId)
          .in("source", ["homework", "mcq"])
          .in("spec_point_id", batch),
    );
    if (reviews.length === 0) return [];

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

    const pts = await selectInSafe<{
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
    );
    if (pts.length === 0) return [];
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
        stability: card && !isFirstContact(card) ? card.stability : null,
        weight: Number(p.weight) > 0 ? Number(p.weight) : 1,
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
    const { data: topics } = await supabase
      .from("topics")
      .select("id")
      .eq("subject", params.subject)
      .eq("board", params.board)
      .eq("level", params.level);
    const topicIds = (topics ?? []).map((t) => t.id);
    if (topicIds.length === 0) return empty;

    const pts = await selectInSafe<{ id: string; code: string; title: string }>(topicIds, (batch) =>
      supabase.from("spec_points").select("id, code, title").in("topic_id", batch),
    );
    if (pts.length === 0) return empty;

    const cards = await this.getSchedule(
      params.studentId,
      pts.map((p) => p.id),
    );
    const weekEnd = new Date(now.getTime() + 7 * 86_400_000);
    const stats = { ...empty, total: pts.length };
    const retained: number[] = [];
    const held: { code: string; title: string; retention: number }[] = [];
    for (const p of pts) {
      const card = cards.get(p.id) ?? null;
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

  /** Best homework/quiz mark per spec point from the review ledger. */
  private static async getMarks(
    studentId: string,
    specPointIds: string[],
  ): Promise<Map<string, { homework: number | null; quiz: number | null }>> {
    const out = new Map<string, { homework: number | null; quiz: number | null }>();
    if (specPointIds.length === 0) return out;
    const reviews = await selectInSafe<{
      spec_point_id: string;
      source: string;
      score_pct: number | null;
    }>(specPointIds, (batch) =>
      supabase
        .from("student_spec_point_reviews")
        .select("spec_point_id, source, score_pct")
        .eq("student_id", studentId)
        .in("source", ["homework", "mcq"])
        .in("spec_point_id", batch),
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

    // Mark each card due now so the roadmap/scheduler see the topic as pending
    // again. New (never-practised) points are already due, so only touch cards.
    const cards = await this.getSchedule(studentId, ids);
    const nowIso = new Date().toISOString();
    if (cards.size > 0) {
      const { error: dueErr } = await supabase.from("student_spec_point_schedule").upsert(
        [...cards.entries()].map(([specPointId, card]) => ({
          student_id: studentId,
          spec_point_id: specPointId,
          card: { ...card, due: new Date() } as unknown as Json,
          due: nowIso,
          updated_at: nowIso,
        })),
        { onConflict: "student_id,spec_point_id" },
      );
      if (dueErr) throw dueErr;
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
