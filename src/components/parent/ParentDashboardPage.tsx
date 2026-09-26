import { Mascot } from "@/components/Doodles";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useAnalytics } from "@/hooks/data/useAnalytics";
import { useChildLinks } from "@/hooks/data/useParentLinks";
import {
  useChildEnrolments,
  useChildCourse,
  useChildTrends,
  useChildEngagement,
  useChildFeedback,
  useChildWeek,
  useChildUpcomingSessions,
  type ChildEnrolment,
  type ChildWeekSubject,
  type UpcomingSession,
  type WeeklyTrendPoint,
} from "@/hooks/data/useChildProgress";
import { GradePredictorCard } from "@/components/parent/GradePredictorCard";
import { EngagementStats } from "@/components/parent/EngagementStats";
import { FeedbackList } from "@/components/parent/FeedbackList";
import { ParentMessages } from "@/components/parent/ParentMessages";
import { ChildWeekCard } from "@/components/parent/ChildWeekCard";
import { UpcomingSessions } from "@/components/parent/UpcomingSessions";
import { EnrolmentSummary } from "@/components/dashboard/StudentDashboardPage";
import { isDemoMode } from "@/lib/auth/session";
import {
  DEMO_ANALYTICS,
  DEMO_ENROLMENTS,
  DEMO_HOMEWORK,
  DEMO_LEVEL,
  DEMO_LIVE,
  DEMO_PARENT_NAME,
  DEMO_SUBMISSIONS,
} from "@/lib/demo/studentDemo";
import { demoWeek } from "@/lib/demo/plannerDemo";
import { resolveDisplayName } from "@/lib/profile/displayName";
import { Suspense, lazy, useMemo, useState } from "react";
import { EmptyState, ErrorNote, SegmentedToggle, Spinner } from "@/components/Shared";

/**
 * Recharts, and the d3 + lodash tail it drags with it, is ~96 kB gzipped — and
 * `TrendsChart` is the only thing in the app that touches it, on this one route.
 * Imported statically it landed in the chunk every route shares, so a parent who
 * had never signed in still downloaded a charting library to read the landing
 * page. Loading it on demand moves the whole thing off everyone else's critical
 * path; the one person who actually sees a chart waits a few hundred
 * milliseconds for it, behind a placeholder the same height as the chart so the
 * page doesn't jump when it arrives.
 */
const TrendsChart = lazy(() =>
  import("@/components/parent/TrendsChart").then((m) => ({ default: m.TrendsChart })),
);

// The parent sees the same child the student showcase shows: grades, marks and
// feedback all come from the student fixtures, so the two demos agree.
const DEMO_ANALYTICS_ROWS = DEMO_ANALYTICS;

const DEMO_TRENDS: WeeklyTrendPoint[] = [
  { biology: 78, chemistry: 70, physics: 58 },
  { biology: 82, chemistry: 72, physics: 64 },
  { biology: 80, chemistry: 76, physics: 60 },
  { biology: 86, chemistry: 78, physics: 68 },
  { biology: 88, chemistry: 81, physics: 71 },
  { biology: 91, chemistry: 83, physics: 76 },
].map((averages, i) => ({
  weekStart: `demo-${i}`,
  label: `Wk ${i + 1}`,
  averages,
}));

// Four pieces of set homework in the student demo; three are handed in and the
// fourth isn't due yet.
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
const DEMO_CHILD_ENROLMENTS: ChildEnrolment[] = DEMO_ENROLMENTS.map((e) => ({
  subject: e.subject,
  board: e.board,
  ...{
    biology: { target_grade: "9", current_grade: "8" },
    chemistry: { target_grade: "8", current_grade: "7" },
    physics: { target_grade: "8", current_grade: "6" },
  }[e.subject],
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

export function ParentDashboard() {
  const { email } = useRoles();
  const { displayName: profileName } = useEnrolments();
  const isDemo = isDemoMode();

  // Which child is being viewed. Defaults to the first linked child; a parent
  // with several children gets a switcher.
  const childrenQ = useChildLinks(!isDemo);
  const children = childrenQ.data ?? [];
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const childId = isDemo ? null : (selectedChildId ?? children[0]?.student_id ?? null);
  const selectedChild = children.find((c) => c.student_id === childId) ?? null;
  const childName = isDemo
    ? "Alex"
    : selectedChild
      ? resolveDisplayName(selectedChild.display_name, selectedChild.email)
      : "your child";

  // Real data, all keyed by the selected child. Every hook no-ops in demo mode
  // (childId stays null there).
  const enrolmentsQ = useChildEnrolments(childId);
  const childEnrolments = enrolmentsQ.data ?? EMPTY_ENROLMENTS;
  const childSubjects = useMemo(() => childEnrolments.map((e) => e.subject), [childEnrolments]);
  const courseQ = useChildCourse(childId);
  const analyticsQ = useAnalytics(childId, childSubjects);
  const trendsQ = useChildTrends(childId);
  const engagementQ = useChildEngagement(childId, childSubjects, courseQ.data);
  const feedbackQ = useChildFeedback(childId);
  const weekQ = useChildWeek(childId, childEnrolments);
  const sessionsQ = useChildUpcomingSessions(childId, childEnrolments, courseQ.data?.level ?? null);

  const analytics = isDemo ? DEMO_ANALYTICS_ROWS : analyticsQ.rows;
  const level = isDemo ? DEMO_LEVEL : (courseQ.data?.level ?? null);
  const trends = isDemo ? DEMO_TRENDS : (trendsQ.data ?? []);
  const trendSubjects = isDemo ? ["biology", "chemistry", "physics"] : childSubjects;
  const engagement = isDemo ? DEMO_ENGAGEMENT : engagementQ.data;
  const feedback = isDemo ? DEMO_FEEDBACK : (feedbackQ.data ?? []);
  const enrolments = isDemo ? DEMO_CHILD_ENROLMENTS : childEnrolments;
  const week = isDemo ? DEMO_WEEK : (weekQ.data ?? []);
  const sessions = isDemo ? DEMO_SESSIONS : (sessionsQ.data ?? []);

  const displayEmailName = isDemo ? DEMO_PARENT_NAME : resolveDisplayName(profileName, email);
  const hasChild = isDemo || !!childId;

  // A failed read used to fall through to the empty copy, telling a parent
  // their child had done no work when the request had simply not come back.
  const queries = [
    childrenQ,
    enrolmentsQ,
    courseQ,
    analyticsQ,
    trendsQ,
    engagementQ,
    feedbackQ,
    weekQ,
    sessionsQ,
  ];
  const error = isDemo ? null : (queries.find((q) => q.error)?.error ?? null);
  const retry = () => queries.forEach((q) => q.error && q.refetch());
  // Likewise the loading gap, which flashed "no subjects yet" on every visit.
  const loading =
    !isDemo &&
    (childrenQ.isLoading || enrolmentsQ.isLoading || courseQ.isLoading || analyticsQ.loading);

  const showEngagement =
    !!engagement && (engagement.sessionsHeld > 0 || engagement.homeworkSet > 0);
  const showSide = showEngagement || feedback.length > 0 || sessions.length > 0;

  return (
    <AppLayout title="Parent Portal">
      {/* Slim welcome ribbon, the same one the student dashboard opens with. */}
      <div data-tour="parent-welcome" className="relative mb-6">
        <Mascot
          name="owl"
          mood="happy"
          size={72}
          idle={false}
          className="peek-in pointer-events-none absolute -top-12 right-6 z-0 hidden text-[color:var(--primary-deep)] sm:block"
        />
        <div className="text-primary-foreground shadow-elegant relative z-10 overflow-hidden rounded-2xl border-2 border-white/15 bg-gradient-to-br from-[var(--primary-deep)] to-[var(--primary)] px-5 py-4 sm:px-6 sm:py-5">
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: "radial-gradient(circle at 30% 20%, white 1.5px, transparent 1.5px)",
              backgroundSize: "24px 24px",
            }}
          />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <span className="bg-accent h-2 w-2 shrink-0 animate-pulse rounded-full" />
              <h2 className="text-lg font-bold tracking-tight text-white sm:text-xl">
                Welcome back, {displayEmailName}
              </h2>
            </div>
            {/* The child's course, as their own ribbon states it. */}
            {hasChild && enrolments.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-primary-foreground/70 text-xs font-semibold">
                  {childName}
                </span>
                <EnrolmentSummary enrolments={enrolments} level={level} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Child switcher — only when there's a choice to make. */}
      {!isDemo && children.length > 1 && (
        <div className="mb-6">
          <SegmentedToggle
            layoutId="parent-child-toggle"
            label="Child"
            value={childId ?? ""}
            onChange={setSelectedChildId}
            items={children.map((c) => ({
              value: c.student_id,
              label: resolveDisplayName(c.display_name, c.email),
            }))}
          />
        </div>
      )}

      {error ? (
        <ErrorNote error={error} onRetry={retry} />
      ) : loading ? (
        <Spinner label={hasChild ? `Loading ${childName}'s progress` : "Loading"} />
      ) : !hasChild ? (
        <EmptyState
          title="No linked children yet"
          body="Enter your child's invite code on the Linked Students page, or accept their invite there."
          action={{ to: "/parents", label: "Link a student" }}
          mascot="owl"
          mood="happy"
        />
      ) : !isDemo && childSubjects.length === 0 ? (
        <EmptyState
          title={`${childName} isn't enrolled yet`}
          body="Their grades, attendance and tutor feedback appear here once they're enrolled in a subject."
          mascot="books"
        />
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className={`space-y-8 ${showSide ? "lg:col-span-2" : "lg:col-span-3"}`}>
            <div data-tour="parent-grades">
              <GradePredictorCard analytics={analytics} level={level} grades={enrolments} />
            </div>
            {week.length > 0 && (
              <div data-tour="parent-week">
                <ChildWeekCard weeks={week} />
              </div>
            )}
            <div data-tour="parent-trends">
              <Suspense
                fallback={<div className="premium-card bg-secondary/40 h-[22rem] animate-pulse" />}
              >
                <TrendsChart points={trends} subjects={trendSubjects} />
              </Suspense>
            </div>
          </div>
          {showSide && (
            <div className="space-y-8">
              {sessions.length > 0 && (
                <div data-tour="parent-sessions">
                  <UpcomingSessions sessions={sessions} />
                </div>
              )}
              {showEngagement && engagement && (
                <div data-tour="parent-engagement">
                  <EngagementStats engagement={engagement} childName={childName} />
                </div>
              )}
              {feedback.length > 0 && (
                <div data-tour="parent-feedback">
                  <FeedbackList items={feedback} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Real parents only: the showcase has no session to send from. */}
      {!isDemo && childId && !error && !loading && (
        <div className="mt-8">
          <ParentMessages childId={childId} childName={childName} />
        </div>
      )}
    </AppLayout>
  );
}

const EMPTY_ENROLMENTS: ChildEnrolment[] = [];
