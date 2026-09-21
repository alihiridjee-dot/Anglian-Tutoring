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
