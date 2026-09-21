import { supabase } from "@/integrations/supabase/client";
import { type SubjectV } from "../curriculum/taxonomy";
import {
  type PointCoverage,
  type PointActivity,
  type PointWork,
  type PointWorkItem,
  noWork,
  practiceInWeek,
} from "./coverage";
import { mapAttemptSources } from "./attemptSources";
import { selectIn, selectInSafe } from "../platform/db/chunked";

/**
 * What happened in a student's weeks, read back: what was delivered, the work
 * attached to each point, and how much of an assigned week was covered. Reads
 * only. The plan itself lives in [[weeklyPlanDal]].
 */
export class WeeklyActivityDAL {
  /**
   * What the programme can account for, across every week it has ever cut.
   *
   * The catch-up rule needs to know which of the spine's past promises were
   * kept ([[backlog]]), and "kept" is not a fact any single week holds: a point
   * promised in July may have been ticked off in August, or may be sitting in
   * next week's plan already. Both are answers, and both live in other rows.
   *
   * Deliberately does not treat mere presence in a plan as delivery — a point
   * the student was offered and never touched is exactly what the backlog is
   * for, and that holds for the week now being cut as much as for a past one.
   * Only weeks *after* it count as outstanding: a point sitting undone in the
   * current week must stay in the backlog, or re-cutting that week would drop
   * it (nothing else re-selects a catch-up point) and the next cut would put it
   * back, flip-flopping the plan week on week.
   *
   * Evidence is the third route and is not read here; it comes from the graded
   * sources ([[scheduleDal]]), which this DAL must not duplicate.
   */
  static async getDeliveryLedger(
    studentId: string,
    subject: SubjectV,
    /** Monday of the week being planned — only later weeks are outstanding. */
    fromWeek: string,
  ): Promise<{ done: Set<string>; outstanding: Set<string> }> {
    const done = new Set<string>();
    const outstanding = new Set<string>();
    const { data, error } = await supabase
      .from("student_weekly_plans")
      .select("week_start, student_weekly_plan_points(spec_point_id, done_at)")
      .eq("student_id", studentId)
      .eq("subject", subject);
    if (error) throw new Error(error.message);

    for (const plan of (data ?? []) as unknown as {
      week_start: string;
      student_weekly_plan_points: { spec_point_id: string; done_at: string | null }[] | null;
    }[]) {
      // Date-keys are YYYY-MM-DD, so a lexical compare is a chronological one.
      const pending = plan.week_start > fromWeek;
      for (const point of plan.student_weekly_plan_points ?? []) {
        if (point.done_at) done.add(point.spec_point_id);
        else if (pending) outstanding.add(point.spec_point_id);
      }
    }
    return { done, outstanding };
  }

  /**
   * For a set of spec points, the work attached to each — the videos,
   * homework and quizzes themselves, not just a count of them.
   *
   * This used to return two booleans, which is all a "practice waiting" chip
   * needs; the checklist has to open the thing, so it needs its id and title.
   * The rows were already coming back — the resource join has always fetched
   * every kind and then kept only homework — so naming them costs one extra
   * lookup (quiz titles) rather than a new pass over the library.
   *
   * `hasHomework`/`hasQuiz` keep their old meaning exactly, unpublished quizzes
   * included: they gate the week's review lock, and narrowing them here would
   * quietly change when a student is allowed to close a week. Only `quizzes`
   * filters to published sets, because only those have somewhere to link to.
   */
  static async getActivity(
    specPointIds: string[],
  ): Promise<Map<string, PointActivity & PointWork>> {
    const out = new Map<string, PointActivity & PointWork>();
    if (specPointIds.length === 0) return out;
    for (const id of specPointIds) out.set(id, { hasHomework: false, hasQuiz: false, ...noWork() });

    type ResRow = {
      id: string;
      kind: string;
      title: string;
      video_url: string | null;
      due_at: string | null;
    };
    const RES_COLS = "id, kind, title, video_url, due_at";

    const [joined, directRes, taggedQ, directSets] = await Promise.all([
      selectInSafe<{ spec_point_id: string; resources: ResRow | null }>(specPointIds, (batch) =>
        supabase
          .from("resource_spec_points")
          .select(`spec_point_id, resources!inner(${RES_COLS})`)
          .in("spec_point_id", batch),
      ),
      // Homework linked straight off the resource rather than through the join
      // table. `mapAttemptSources` counts both, so this must too — a homework
      // visible to coverage but invisible here would let the review's lock open
      // on work it can't see.
      selectInSafe<ResRow & { spec_point_id: string | null }>(specPointIds, (batch) =>
        supabase.from("resources").select(`spec_point_id, ${RES_COLS}`).in("spec_point_id", batch),
      ),
      selectInSafe<{ spec_point_id: string | null; set_id: string }>(specPointIds, (batch) =>
        supabase.from("mcq_questions").select("spec_point_id, set_id").in("spec_point_id", batch),
      ),
      selectInSafe<{ spec_point_id: string | null; id: string; title: string; published: boolean }>(
        specPointIds,
        (batch) =>
          supabase
            .from("mcq_sets")
            .select("spec_point_id, id, title, published")
            .in("spec_point_id", batch),
      ),
    ]);

    /** File a resource under the list its kind belongs in, de-duplicated by id. */
    const addResource = (specPointId: string | null, r: ResRow | null) => {
      if (!specPointId || !r) return;
      const e = out.get(specPointId);
      if (!e) return;
      const item: PointWorkItem = {
        id: r.id,
        title: r.title,
        videoUrl: r.video_url,
        dueAt: r.due_at,
      };
      const list = r.kind === "homework" ? e.homework : r.kind === "video" ? e.videos : null;
      // `live_session` resources belong to the live banner, not the checklist.
      if (!list || list.some((x) => x.id === item.id)) return;
      list.push(item);
      if (r.kind === "homework") e.hasHomework = true;
    };

    for (const r of joined) addResource(r.spec_point_id, r.resources);
    for (const r of directRes) addResource(r.spec_point_id, r);

    // Both routes to a quiz: a set tagged to the point, and a set holding a
    // question tagged to it. The first names itself; the second needs a lookup.
    const setsForPoint = new Map<string, Set<string>>();
    const known = new Map<string, { title: string; published: boolean }>();
    const note = (specPointId: string | null, setId: string) => {
      if (!specPointId || !out.has(specPointId)) return;
      out.get(specPointId)!.hasQuiz = true;
      const s = setsForPoint.get(specPointId) ?? new Set<string>();
      s.add(setId);
      setsForPoint.set(specPointId, s);
    };
    for (const r of directSets) {
      known.set(r.id, { title: r.title, published: r.published });
      note(r.spec_point_id, r.id);
    }
    for (const r of taggedQ) note(r.spec_point_id, r.set_id);

    const missing = [...new Set([...setsForPoint.values()].flatMap((s) => [...s]))].filter(
      (id) => !known.has(id),
    );
    if (missing.length) {
      const rows = await selectInSafe<{ id: string; title: string; published: boolean }>(
        missing,
        (batch) => supabase.from("mcq_sets").select("id, title, published").in("id", batch),
      );
      for (const r of rows) known.set(r.id, { title: r.title, published: r.published });
    }

    for (const [specPointId, ids] of setsForPoint) {
      const e = out.get(specPointId)!;
      for (const id of ids) {
        const meta = known.get(id);
        if (!meta?.published) continue;
        if (e.quizzes.some((q) => q.id === id)) continue;
        e.quizzes.push({ id, title: meta.title });
      }
    }

    return out;
  }

  /**
   * What the student actually did on each spec point — homework submissions and
   * MCQ attempts, both already spec-point-linked. Returns a per-point best score
   * so the check-in can grade coverage. Reads the given student's rows, so it
   * works both for the student themselves and for a tutor viewing them (RLS on
   * homework_submissions / mcq_attempts already allows tutor reads).
   */
  static async getCoverage(
    studentId: string,
    specPointIds: string[],
    weekStart?: string,
  ): Promise<Map<string, PointCoverage>> {
    const out = new Map<string, PointCoverage>();
    for (const id of specPointIds) {
      out.set(id, {
        attempted: false,
        homeworkDone: false,
        quizDone: false,
        bestScore: null,
        homeworkScore: null,
        quizScore: null,
      });
    }
    if (specPointIds.length === 0) return out;

    // spec point → homework resource ids, and → mcq set ids.
    const { resourceToPoints, setToPoints } = await mapAttemptSources(specPointIds);

    const resourceIds = [...resourceToPoints.keys()];
    const setIds = [...setToPoints.keys()];

    const [subs, attempts] = await Promise.all([
      selectIn<{ resource_id: string; score_pct: number | null; submitted_at: string }>(
        resourceIds,
        (batch) =>
          supabase
            .from("homework_submissions")
            .select("resource_id, score_pct, submitted_at")
            .eq("student_id", studentId)
            .in("resource_id", batch),
      ),
      selectIn<{
        set_id: string;
        score: number | null;
        total: number | null;
        created_at: string;
      }>(setIds, (batch) =>
        supabase
          .from("mcq_attempts")
          .select("set_id, score, total, created_at")
          .eq("user_id", studentId)
          .in("set_id", batch),
      ),
    ]);

    const merge = (a: number | null, b: number | null) =>
      b == null ? a : a == null ? b : Math.max(a, b);

    for (const sub of subs) {
      if (!practiceInWeek(sub.submitted_at, weekStart)) continue;
      const pct = sub.score_pct == null ? null : Math.round(Number(sub.score_pct));
      for (const p of resourceToPoints.get(sub.resource_id) ?? []) {
        const e = out.get(p);
        if (!e) continue;
        e.attempted = true;
        e.homeworkDone = true;
        e.bestScore = merge(e.bestScore, pct);
        e.homeworkScore = merge(e.homeworkScore, pct);
      }
    }
    for (const a of attempts) {
      if (!practiceInWeek(a.created_at, weekStart)) continue;
      const pct = a.total ? Math.round(((a.score ?? 0) / a.total) * 100) : null;
      for (const p of setToPoints.get(a.set_id) ?? []) {
        const e = out.get(p);
        if (!e) continue;
        e.attempted = true;
        e.quizDone = true;
        e.bestScore = merge(e.bestScore, pct);
        e.quizScore = merge(e.quizScore, pct);
      }
    }
    return out;
  }
}
