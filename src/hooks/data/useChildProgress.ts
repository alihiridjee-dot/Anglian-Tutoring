import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentWeekKey } from "@/lib/planner/week";
import type { BoardV, LevelV, SubjectV } from "@/lib/curriculum/taxonomy";
import { WeeklyPlanDAL, type PlanPoint } from "@/lib/planner/weeklyPlanDal";
import { WeeklyNotesDAL } from "@/lib/planner/weeklyNotesDal";
import { weeklyQuizAverages, type ScoredWorkRow } from "@/lib/profile/analytics";
import { scoredWorkQuery } from "@/hooks/data/useAnalytics";

export type { WeeklyTrendPoint } from "@/lib/profile/analytics";

/**
 * Real progress data for one student, read by a linked parent (or the student
 * themselves — the queries are identity-agnostic and RLS decides visibility).
 *
 * Everything is keyed by studentId so a parent with several children can flip
 * between them and each child's data caches independently.
 */

const CHILD_KEY = ["child-progress"] as const;

export interface ChildEnrolment {
  subject: SubjectV;
  board: BoardV;
  /** Set by the tutor on the student's record; null until they do. */
  target_grade: string | null;
  current_grade: string | null;
}

/**
 * The child's enrolments — subject, exam board, and the target and current
 * grades their tutor has recorded (parents can read student_enrolments).
 */
export function useChildEnrolments(studentId: string | null) {
  return useQuery({
    queryKey: [...CHILD_KEY, "enrolments", studentId],
    queryFn: async (): Promise<ChildEnrolment[]> => {
      const { data, error } = await supabase
        .from("student_enrolments")
        .select("subject, board, target_grade, current_grade")
        .eq("student_id", studentId!)
        .order("subject");
      if (error) throw new Error(error.message);
      return (data ?? []) as ChildEnrolment[];
    },
    enabled: !!studentId,
  });
}

export interface ChildCourse {
  /** Null for a student who hasn't picked a level yet. */
  level: LevelV | null;
  /** When the account was made — nothing before it was theirs to attend. */
  joinedAt: string;
}

/** The child's level and join date (parents can read a linked child's profile). */
export function useChildCourse(studentId: string | null) {
  return useQuery({
    queryKey: [...CHILD_KEY, "course", studentId],
    queryFn: async (): Promise<ChildCourse> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("level, created_at")
        .eq("id", studentId!)
        .single();
      if (error) throw new Error(error.message);
      return { level: data.level, joinedAt: data.created_at };
    },
    enabled: !!studentId,
  });
}

/**
 * Weekly MCQ averages per subject over the last `weeks` weeks — the real
 * version of the trends chart, cut from the scored work the predicted grades
 * already read (`scoredWorkQuery`), so it costs no request of its own.
 */
export function useChildTrends(studentId: string | null, weeks = 6) {
  const select = useCallback((rows: ScoredWorkRow[]) => weeklyQuizAverages(rows, weeks), [weeks]);
  return useQuery({ ...scoredWorkQuery(studentId), select });
}

export interface ChildEngagement {
  /** Past live sessions in the child's subjects. */
  sessionsHeld: number;
  sessionsAttended: number;
  homeworkSet: number;
  homeworkSubmitted: number;
}

/**
 * Attendance and homework-completion counts — the real engagement stats.
 *
 * Counted on the server (student_engagement) with the child's own list rules:
 * their level, each subject's board, since they took that subject up, and
 * only homework a tutor set whose due date has passed. Counting every brief at
 * the level told the parent of a child who joined in October "0 of 12 handed
 * in", including sheets the child never saw (S-24). The server also reads past
 * the paywall, so a paused or lapsed child keeps their record (S-23).
 *
 * `subjects` and `course` aren't sent: they key the cache, so a changed board
 * or level recounts, and hold the read until the course is known.
 */
export function useChildEngagement(
  studentId: string | null,
  subjects: string[],
  course: ChildCourse | undefined,
) {
  return useQuery({
    queryKey: [
      ...CHILD_KEY,
      "engagement",
      studentId,
      [...subjects].sort(),
      course?.level,
      course?.joinedAt,
    ],
    queryFn: async (): Promise<ChildEngagement> => {
      const { data, error } = await supabase.rpc("student_engagement", {
        _student_id: studentId!,
      });
      if (error) throw new Error(error.message);
      // No row means the caller isn't the student, a linked parent or a tutor.
      const row = data?.[0];
      if (!row) throw new Error("This student's engagement isn't available to your account.");
      return {
        sessionsHeld: row.sessions_held,
        sessionsAttended: row.sessions_attended,
        homeworkSet: row.homework_set,
        homeworkSubmitted: row.homework_submitted,
      };
    },
    enabled: !!studentId && subjects.length > 0 && !!course,
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

/**
 * The most recent pieces of real tutor feedback on the child's homework.
 *
 * Two reads, one of them shared: the comments from the submissions, and each
 * sheet's subject and title from the scored work the predicted grades already
 * read (an embed of resources is empty once the child's plan lapses, S-23).
 * Returned in the shape of one query, so a caller treats it as one.
 */
export function useChildFeedback(studentId: string | null, limit = 4) {
  const work = useQuery(scoredWorkQuery(studentId));
  const marked = useQuery({
    queryKey: [...CHILD_KEY, "feedback", studentId, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homework_submissions")
        .select("id, feedback, grade, score_pct, graded_at")
        .eq("student_id", studentId!)
        .not("feedback", "is", null)
        .not("graded_at", "is", null)
        .order("graded_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!studentId,
  });

  const data = useMemo((): FeedbackItem[] | undefined => {
    if (!marked.data || !work.data) return undefined;
    const sheetOf = new Map(
      work.data.filter((w) => w.kind === "homework").map((w) => [w.item_id, w]),
    );
    return marked.data.flatMap((s) => {
      const sheet = sheetOf.get(s.id);
      if (!sheet?.subject || sheet.title === null || !s.feedback || !s.graded_at) return [];
      return [
        {
          id: s.id,
          subject: sheet.subject,
          homeworkTitle: sheet.title,
          feedback: s.feedback,
          grade: s.grade,
          scorePct: s.score_pct,
          gradedAt: s.graded_at,
        },
      ];
    });
  }, [marked.data, work.data]);

  const { refetch: refetchMarked } = marked;
  const { refetch: refetchWork } = work;
  const refetch = useCallback(
    () => Promise.all([refetchMarked(), refetchWork()]),
    [refetchMarked, refetchWork],
  );

  return {
    data,
    error: marked.error ?? work.error,
    isLoading: marked.isLoading || work.isLoading,
    refetch,
  };
}

export interface ChildWeekSubject {
  subject: SubjectV;
  points: PlanPoint[];
  /** The tutor's note on this week, when they've written one. */
  tutorNote: string | null;
}

/**
 * This week's plan in each of the child's subjects, with the tutor's note.
 *
 * Read-only. The student's own dashboard builds and saves the week the first
 * time they open it; a parent only ever reads what is there, so a subject the
 * child hasn't opened this week simply has no entry. The plan comes through
 * the same `getPlan` the student's panel uses, so a parent sees exactly the
 * points their child does, with the same points withheld.
 */
export function useChildWeek(studentId: string | null, enrolments: ChildEnrolment[]) {
  const weekStart = currentWeekKey();
  return useQuery({
    queryKey: [...CHILD_KEY, "week", studentId, weekStart, enrolments.map((e) => e.subject)],
    queryFn: async (): Promise<ChildWeekSubject[]> => {
      const weeks = await Promise.all(
        enrolments.map((e) => WeeklyPlanDAL.getPlan(studentId!, e.subject, weekStart)),
      );
      const planned = enrolments.flatMap((e, i) => {
        const week = weeks[i];
        return week && week.points.length > 0 ? [{ subject: e.subject, week }] : [];
      });
      // Every subject's note in one read, rather than one per subject.
      const notes = await WeeklyNotesDAL.getTutorNotes(planned.map((p) => p.week.plan.id));
      return planned.map(({ subject, week }) => ({
        subject,
        points: week.points,
        tutorNote: notes.get(week.plan.id)?.note?.trim() || null,
      }));
    },
    enabled: !!studentId && enrolments.length > 0,
  });
}

export interface UpcomingSession {
  id: string;
  title: string;
  subject: SubjectV;
  starts_at: string;
}

/**
 * The next live sessions on the child's course: their level, and each
 * subject's own exam board. No join link — a parent is told when their child's
 * lessons are, not handed the way in.
 *
 * `level` is undefined until the child's course has been read (null is a
 * child with no level yet). Waiting for it means one read: started without
 * it, the sessions were fetched once unfiltered and again when it arrived.
 */
export function useChildUpcomingSessions(
  studentId: string | null,
  enrolments: ChildEnrolment[],
  level: LevelV | null | undefined,
  limit = 3,
) {
  return useQuery({
    queryKey: [
      ...CHILD_KEY,
      "sessions",
      studentId,
      level,
      enrolments.map((e) => `${e.subject}:${e.board}`),
      limit,
    ],
    queryFn: async (): Promise<UpcomingSession[]> => {
      let q = supabase
        .from("resources")
        .select("id, title, subject, board, starts_at")
        .eq("kind", "live_session")
        .in(
          "subject",
          enrolments.map((e) => e.subject),
        )
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(50);
      if (level) q = q.eq("level", level);
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      // Board is per subject, which a single filter can't say. A session with
      // no board recorded is open to every board.
      const boardOf = new Map(enrolments.map((e) => [e.subject, e.board]));
      return (data ?? [])
        .filter((r) => !r.board || r.board === boardOf.get(r.subject as SubjectV))
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          title: r.title,
          subject: r.subject as SubjectV,
          starts_at: r.starts_at!,
        }));
    },
    enabled: !!studentId && enrolments.length > 0 && level !== undefined,
  });
}
