import type { PortalData } from "@/components/parent/ParentDashboardPage";
import type {
  ChildEnrolment,
  ChildWeekSubject,
  UpcomingSession,
  WeeklyTrendPoint,
} from "@/hooks/data/useChildProgress";
import {
  DEMO_ANALYTICS,
  DEMO_ENROLMENTS,
  DEMO_HOMEWORK,
  DEMO_LEVEL,
  DEMO_LIVE,
  DEMO_MCQ_ATTEMPTS,
  DEMO_MCQ_SETS,
  DEMO_PARENT_NAME,
  DEMO_SUBMISSIONS,
} from "@/lib/demo/studentDemo";
import { demoWeek } from "@/lib/demo/plannerDemo";

/*
 * The parent showcase's child. Only the /demo/parent route passes it to the
 * Portal, so none of this ships with, or can leak into, a real parent's page.
 *
 * The parent sees the same child the student showcase shows: grades, marks and
 * feedback all come from the student fixtures, so the two demos agree.
 */

// This week's quiz average per subject, from the quizzes the student showcase
// shows as done this week.
const thisWeekQuizAverage = (subject: string) => {
  const pcts = DEMO_MCQ_SETS.filter(
    (s) => s.thisWeek && s.subject === subject && DEMO_MCQ_ATTEMPTS[s.id],
  ).map((s) => (DEMO_MCQ_ATTEMPTS[s.id].score * 100) / DEMO_MCQ_ATTEMPTS[s.id].total);
  return Math.round(pcts.reduce((a, b) => a + b, 0) / Math.max(pcts.length, 1));
};

// The weeks before this one are illustrative; this week is Alex's real quizzes.
const DEMO_TRENDS: WeeklyTrendPoint[] = [
  { biology: 78, chemistry: 70, physics: 58 },
  { biology: 82, chemistry: 72, physics: 64 },
  { biology: 80, chemistry: 76, physics: 60 },
  { biology: 86, chemistry: 74, physics: 68 },
  { biology: 88, chemistry: 78, physics: 71 },
  {
    biology: thisWeekQuizAverage("biology"),
    chemistry: thisWeekQuizAverage("chemistry"),
    physics: thisWeekQuizAverage("physics"),
  },
].map((averages, i) => ({
  weekStart: `demo-${i}`,
  label: `Wk ${i + 1}`,
  averages,
}));

// The set tasks in the student demo (those with a due date): all handed in but
// the I–V task, which isn't due yet.
const DEMO_ENGAGEMENT = {
  sessionsHeld: 16,
  sessionsAttended: 15,
  homeworkSet: DEMO_HOMEWORK.filter((h) => h.due_at).length,
  homeworkSubmitted: DEMO_HOMEWORK.filter((h) => h.due_at && DEMO_SUBMISSIONS[h.id]).length,
};

const DEMO_FEEDBACK = DEMO_HOMEWORK.flatMap((h) => {
  const sub = DEMO_SUBMISSIONS[h.id];
  if (!sub?.feedback || !sub.graded_at) return [];
  return [
    {
      id: sub.id,
      subject: h.subject,
      homeworkTitle: h.title,
      feedback: sub.feedback,
      grade: sub.grade,
      scorePct: sub.score_pct,
      gradedAt: sub.graded_at,
    },
  ];
}).sort((a, b) => b.gradedAt.localeCompare(a.gradedAt));

// The showcase child's tutor has recorded a target and a current grade for
// each subject, a little under the predictions above so the two read together.
// The same fixture gives Alex's own Target ring, so the two pages agree.
const DEMO_CHILD_ENROLMENTS: ChildEnrolment[] = DEMO_ENROLMENTS.map((e) => ({
  subject: e.subject,
  board: e.board,
  target_grade: e.targetGrade,
  current_grade: e.currentGrade,
}));

// The same week the student showcase plans, so the two demos agree.
const DEMO_WEEK: ChildWeekSubject[] = DEMO_ENROLMENTS.map((e) => ({
  subject: e.subject,
  points: demoWeek(e.subject).points,
  tutorNote:
    e.subject === "biology"
      ? "Alex is flying through cell biology. This week I'd like the 6-mark answers written out in full, not in note form."
      : null,
}));

const DEMO_SESSIONS: UpcomingSession[] = DEMO_LIVE.filter(
  (s) => new Date(s.starts_at).getTime() > Date.now(),
).map((s) => ({
  id: s.id,
  title: s.title,
  subject: s.subject as UpcomingSession["subject"],
  starts_at: s.starts_at,
}));

/** Alex, as the showcase parent sees them. */
export const DEMO_PORTAL: PortalData = {
  parentName: DEMO_PARENT_NAME,
  childName: "Alex",
  level: DEMO_LEVEL,
  enrolments: DEMO_CHILD_ENROLMENTS,
  analytics: DEMO_ANALYTICS,
  trends: DEMO_TRENDS,
  trendSubjects: ["biology", "chemistry", "physics"],
  engagement: DEMO_ENGAGEMENT,
  feedback: DEMO_FEEDBACK,
  week: DEMO_WEEK,
  sessions: DEMO_SESSIONS,
};
