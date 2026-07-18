import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mondayOf, toDateKey } from "@/lib/week";

/**
 * Real progress data for one student, read by a linked parent (or the student
 * themselves — the queries are identity-agnostic and RLS decides visibility).
 *
 * Everything is keyed by studentId so a parent with several children can flip
 * between them and each child's data caches independently.
 */

const CHILD_KEY = ["child-progress"] as const;

/** The child's enrolled subjects (parents can read student_enrolments). */
export function useChildSubjects(studentId: string | null) {
  return useQuery({
    queryKey: [...CHILD_KEY, "subjects", studentId],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("student_enrolments")
        .select("subject")
        .eq("student_id", studentId!)
        .order("subject");
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => r.subject as string);
    },
    enabled: !!studentId,
  });
}

export interface WeeklyTrendPoint {
  /** ISO date of the Monday starting the week. */
  weekStart: string;
  /** Short label for the axis, e.g. "7 Jul". */
  label: string;
  /** subject → average % that week (absent if no attempts). */
  averages: Record<string, number>;
}

/**
 * Weekly MCQ averages per subject over the last `weeks` weeks — the real
 * version of the trends chart. Weeks with no attempts simply have no entry for
 * that subject, and the chart connects across the gap.
 */
export function useChildTrends(studentId: string | null, weeks = 6) {
  return useQuery({
    queryKey: [...CHILD_KEY, "trends", studentId, weeks],
    queryFn: async (): Promise<WeeklyTrendPoint[]> => {
      const since = new Date();
      since.setDate(since.getDate() - weeks * 7);

      const { data, error } = await supabase
        .from("mcq_attempts")
        .select("score, total, created_at, mcq_sets(subject)")
        .eq("user_id", studentId!)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);

      // Bucket by week start, averaging per subject.
      const buckets: Record<string, Record<string, { sum: number; n: number }>> = {};
      for (const a of data ?? []) {
        const subj = (a.mcq_sets as unknown as { subject: string | null } | null)?.subject;
        if (!subj || !a.total) continue;
        const week = toDateKey(mondayOf(new Date(a.created_at)));
        buckets[week] = buckets[week] ?? {};
        buckets[week][subj] = buckets[week][subj] ?? { sum: 0, n: 0 };
        buckets[week][subj].sum += (a.score / a.total) * 100;
        buckets[week][subj].n += 1;
      }

      // Emit a continuous run of weeks ending this week, so the x-axis is
      // stable even when some weeks are quiet.
      const points: WeeklyTrendPoint[] = [];
      const thisWeek = mondayOf(new Date());
      for (let i = weeks - 1; i >= 0; i--) {
        const d = new Date(thisWeek);
        d.setDate(d.getDate() - i * 7);
        const key = toDateKey(d);
        const averages: Record<string, number> = {};
        for (const [subj, { sum, n }] of Object.entries(buckets[key] ?? {})) {
          averages[subj] = Math.round(sum / n);
        }
        points.push({
          weekStart: key,
          label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
          averages,
        });
      }
      return points;
    },
    enabled: !!studentId,
  });
}

export interface ChildEngagement {
  /** Past live sessions in the child's subjects. */
  sessionsHeld: number;
  sessionsAttended: number;
  homeworkSet: number;
  homeworkSubmitted: number;
}

/** Attendance and homework-completion counts — the real engagement stats. */
export function useChildEngagement(studentId: string | null, subjects: string[]) {
  return useQuery({
    queryKey: [...CHILD_KEY, "engagement", studentId, [...subjects].sort()],
    queryFn: async (): Promise<ChildEngagement> => {
      const nowIso = new Date().toISOString();
      const subjectList = subjects as ("biology" | "chemistry" | "physics")[];

      const [sessions, attended, homework, submissions] = await Promise.all([
        supabase
          .from("resources")
          .select("id", { count: "exact", head: true })
          .eq("kind", "live_session")
          .in("subject", subjectList)
          .lt("starts_at", nowIso),
        supabase
          .from("session_attendees")
          .select("id", { count: "exact", head: true })
          .eq("user_id", studentId!),
        supabase
          .from("resources")
          .select("id", { count: "exact", head: true })
          .eq("kind", "homework")
          .in("subject", subjectList),
        supabase
          .from("homework_submissions")
          .select("id", { count: "exact", head: true })
          .eq("student_id", studentId!),
      ]);
      for (const r of [sessions, attended, homework, submissions]) {
        if (r.error) throw new Error(r.error.message);
      }

      return {
        sessionsHeld: sessions.count ?? 0,
        // A student can technically hold join-records for sessions since
        // removed; never report more than 100%.
        sessionsAttended: Math.min(attended.count ?? 0, sessions.count ?? 0),
        homeworkSet: homework.count ?? 0,
        homeworkSubmitted: Math.min(submissions.count ?? 0, homework.count ?? 0),
      };
    },
    enabled: !!studentId && subjects.length > 0,
  });
}

export interface FeedbackItem {
  id: string;
  subject: string;
  homeworkTitle: string;
  feedback: string;
  grade: string | null;
  scorePct: number | null;
  gradedAt: string;
}

/** The most recent pieces of real tutor feedback on the child's homework. */
export function useChildFeedback(studentId: string | null, limit = 4) {
  return useQuery({
    queryKey: [...CHILD_KEY, "feedback", studentId, limit],
    queryFn: async (): Promise<FeedbackItem[]> => {
      const { data, error } = await supabase
        .from("homework_submissions")
        .select("id, feedback, grade, score_pct, graded_at, resources(subject, title)")
        .eq("student_id", studentId!)
        .not("feedback", "is", null)
        .not("graded_at", "is", null)
        .order("graded_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);

      return (data ?? []).flatMap((s) => {
        const res = s.resources as unknown as { subject: string; title: string } | null;
        if (!res || !s.feedback || !s.graded_at) return [];
        return [
          {
            id: s.id,
            subject: res.subject,
            homeworkTitle: res.title,
            feedback: s.feedback,
            grade: s.grade,
            scorePct: s.score_pct,
            gradedAt: s.graded_at,
          },
        ];
      });
    },
    enabled: !!studentId,
  });
}
