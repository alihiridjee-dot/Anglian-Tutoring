import { supabase } from "@/integrations/supabase/client";
import { type SubjectV, type BoardV, type LevelV } from "../curriculum/taxonomy";
import { selectInSafe, selectInHistory } from "../platform/db/chunked";

/** A spec point's display label. */
export interface SpecPointLabel {
  id: string;
  code: string;
  title: string;
}

/** One student as seen from the tutor's planner picker. */
export interface PlannerStudent {
  id: string;
  name: string | null;
  level: LevelV | null;
  enrolments: { subject: SubjectV; board: BoardV }[];
}

/**
 * One student's saved week for one subject, as the roster shows it: enough to
 * say "6 set · 2 done · 1 by you" without loading the week itself. A missing
 * entry means the week has no plan row yet — the student has not opened it.
 */
export interface RosterWeekSummary {
  planId: string;
  subject: SubjectV;
  /** `ai` once the programme has cut it; `tutor` / `student` while only a person has. */
  source: "ai" | "student" | "tutor";
  total: number;
  done: number;
  /** Hand-picked by the tutor. */
  pinned: number;
}

/** Lookups the tutor's planner needs: who the students are, and what a spec point is called. */
export class PlannerRosterDAL {
  /** Display labels (code + title) for a set of spec points, in curriculum order. */
  static async getSpecPointLabels(specPointIds: string[]): Promise<SpecPointLabel[]> {
    if (specPointIds.length === 0) return [];
    const data = await selectInSafe<{
      id: string;
      code: string;
      title: string;
      sort_order: number | null;
      topics: { sort_order: number | null } | null;
    }>(specPointIds, (batch) =>
      supabase
        .from("spec_points")
        .select("id, code, title, sort_order, topics!inner(sort_order)")
        .in("id", batch),
    );
    return data
      .map((p) => ({
        id: p.id,
        code: p.code,
        title: p.title,
        _ts: p.topics?.sort_order ?? 0,
        _ps: p.sort_order ?? 0,
      }))
      .sort((a, b) => a._ts - b._ts || a._ps - b._ps || a.code.localeCompare(b.code))
      .map(({ _ts, _ps, ...p }) => p);
  }

  /**
   * Every student's saved plan for one week, keyed by student id, in one read.
   *
   * The roster has to answer "who has a week set, and how is it going" for
   * every student at once, and loading each student's roadmap to say so would
   * be one heavy read per row. The plan rows alone carry the answer: whether
   * the week exists, how many points it holds, how many are ticked, and how
   * many the tutor pinned. Coverage — how the work went — stays with the
   * student's own pane, where it is one student's worth of reads.
   */
  static async weekSummaries(weekStart: string): Promise<Map<string, RosterWeekSummary[]>> {
    type Row = {
      id: string;
      student_id: string;
      subject: string;
      source: "ai" | "student" | "tutor";
      student_weekly_plan_points: { origin: string; done_at: string | null }[] | null;
    };
    const rows = await selectInHistory<Row>(["week"], (_batch, after) => {
      const query = supabase
        .from("student_weekly_plans")
        .select("id, student_id, subject, source, student_weekly_plan_points(origin, done_at)")
        .eq("week_start", weekStart)
        .order("id")
        .limit(500);
      return after ? query.gt("id", after) : query;
    });
    const out = new Map<string, RosterWeekSummary[]>();
    for (const r of rows ?? []) {
      const points = r.student_weekly_plan_points ?? [];
      const list = out.get(r.student_id) ?? [];
      list.push({
        planId: r.id,
        subject: r.subject as SubjectV,
        source: r.source,
        total: points.length,
        done: points.filter((p) => !!p.done_at).length,
        pinned: points.filter((p) => p.origin === "tutor").length,
      });
      out.set(r.student_id, list);
    }
    return out;
  }

  /**
   * Students (with their level + enrolments) for the tutor's planner picker.
   * Tutors can read all profiles and enrolments, so this is a plain roster —
   * anyone with at least one subject enrolment is plannable.
   */
  static async listStudents(): Promise<PlannerStudent[]> {
    // Keyset pagination reads the complete roster even when the API caps rows.
    const [profiles, enrols] = await Promise.all([
      selectInHistory<{
        id: string;
        display_name: string | null;
        level: LevelV | null;
        role: string | null;
      }>(["roster"], (_batch, after) => {
        const query = supabase
          .from("profiles")
          .select("id, display_name, level, role")
          .order("id")
          .limit(500);
        return after ? query.gt("id", after) : query;
      }),
      selectInHistory<{
        id: string;
        student_id: string;
        subject: string;
        board: string;
      }>(["enrolments"], (_batch, after) => {
        const query = supabase
          .from("student_enrolments")
          .select("id, student_id, subject, board")
          .order("id")
          .limit(500);
        return after ? query.gt("id", after) : query;
      }),
    ]);
    const byStudent = new Map<string, { subject: SubjectV; board: BoardV }[]>();
    for (const e of (enrols ?? []) as Array<{
      student_id: string;
      subject: string;
      board: string;
    }>) {
      const list = byStudent.get(e.student_id) ?? [];
      list.push({ subject: e.subject as SubjectV, board: e.board as BoardV });
      byStudent.set(e.student_id, list);
    }
    return (
      (profiles ?? []) as Array<{
        id: string;
        display_name: string | null;
        level: LevelV | null;
        role: string | null;
      }>
    )
      .filter((p) => (p.role ?? "student") === "student")
      .map((p) => ({
        id: p.id,
        name: p.display_name,
        level: p.level,
        enrolments: byStudent.get(p.id) ?? [],
      }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }
}
