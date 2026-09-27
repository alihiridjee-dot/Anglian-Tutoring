import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentWeekKey, mondayOf, toDateKey } from "@/lib/planner/week";
import type { BoardV, LevelV, SubjectV } from "@/lib/curriculum/taxonomy";
import { WeeklyPlanDAL, type PlanPoint } from "@/lib/planner/weeklyPlanDal";
import { WeeklyNotesDAL } from "@/lib/planner/weeklyNotesDal";

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

/**
 * Attendance and homework-completion counts — the real engagement stats.
 *
 * Counted against the child's own course: sessions and homework at their level
 * only, and only sessions held since they joined. Counting every level's
 * sessions since the platform began told the parent of an iGCSE student who
 * joined last month that they had missed nearly all of them.
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
      const nowIso = new Date().toISOString();
      const subjectList = subjects as ("biology" | "chemistry" | "physics")[];
      // No level yet means the student's own pages don't filter by one either.
      const level = course!.level;
      const since = course!.joinedAt;

      let sessionsQ = supabase
        .from("resources")
        .select("id", { count: "exact", head: true })
        .eq("kind", "live_session")
        .in("subject", subjectList)
        .gte("starts_at", since)
        .lt("starts_at", nowIso);
      // The same population as above, so a join record for another level's
      // session can't push attendance past what was held.
      let attendedQ = supabase
        .from("session_attendees")
        .select("id, resources!inner(kind, subject, level, starts_at)", {
          count: "exact",
          head: true,
        })
        .eq("user_id", studentId!)
        .eq("resources.kind", "live_session")
        .in("resources.subject", subjectList)
        .gte("resources.starts_at", since)
        .lt("resources.starts_at", nowIso);
      let homeworkQ = supabase
        .from("resources")
        .select("id", { count: "exact", head: true })
        .eq("kind", "homework")
        .eq("origin", "tutor")
        .in("subject", subjectList);
      let submissionsQ = supabase
        .from("homework_submissions")
        .select("id, resources!inner(origin, subject, level)", { count: "exact", head: true })
        .eq("student_id", studentId!)
        .eq("resources.origin", "tutor")
        .in("resources.subject", subjectList);
      if (level) {
        sessionsQ = sessionsQ.eq("level", level);
        attendedQ = attendedQ.eq("resources.level", level);
        homeworkQ = homeworkQ.eq("level", level);
        submissionsQ = submissionsQ.eq("resources.level", level);
      }

      const [sessions, attended, homework, submissions] = await Promise.all([
        sessionsQ,
        attendedQ,
        // Only homework somebody actually set. The planner writes a practice
        // sheet for every spec point a student's week reaches, and counting
        // those would show a parent "4 of 180 handed in" — a number that says
        // their child is failing when it is really measuring the size of the
        // library.
        homeworkQ,
        // Counted against the same population as `homeworkSet` above. Without
        // the join a term of enthusiastic practice reads as every set homework
        // handed in, because the pair is clamped to each other below.
        submissionsQ,
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
        enrolments.map(async (e) => {
          const week = await WeeklyPlanDAL.getPlan(studentId!, e.subject, weekStart);
          if (!week || week.points.length === 0) return null;
          const note = await WeeklyNotesDAL.getTutorNote(week.plan.id);
          return { subject: e.subject, points: week.points, tutorNote: note?.note?.trim() || null };
        }),
      );
      return weeks.filter((w): w is ChildWeekSubject => w !== null);
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
 */
export function useChildUpcomingSessions(
  studentId: string | null,
  enrolments: ChildEnrolment[],
  level: LevelV | null,
  limit = 3,
) {
  return useQuery({
    queryKey: [...CHILD_KEY, "sessions", studentId, level, enrolments, limit],
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
    enabled: !!studentId && enrolments.length > 0,
  });
}
