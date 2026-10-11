import { Mascot } from "@/components/Doodles";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useAnalytics } from "@/hooks/data/useAnalytics";
import { useChildLinks, type ChildLink } from "@/hooks/data/useParentLinks";
import { useEntryState } from "@/hooks/useEntryState";
import {
  useChildEnrolments,
  useChildCourse,
  useChildTrends,
  useChildEngagement,
  useChildFeedback,
  useChildWeek,
  useChildUpcomingSessions,
  type ChildEngagement,
  type ChildEnrolment,
  type ChildWeekSubject,
  type FeedbackItem,
  type UpcomingSession,
  type WeeklyTrendPoint,
} from "@/hooks/data/useChildProgress";
import { GradePredictorCard } from "@/components/parent/GradePredictorCard";
import { EngagementStats } from "@/components/parent/EngagementStats";
import { FeedbackList } from "@/components/parent/FeedbackList";
import { ParentMessages } from "@/components/parent/ParentMessages";
import { ChildWeekCard } from "@/components/parent/ChildWeekCard";
import { ChildBreakCard } from "@/components/parent/ChildBreakCard";
import { UpcomingSessions } from "@/components/parent/UpcomingSessions";
import { EnrolmentSummary } from "@/components/CourseBadge";
import { studentBreaksQuery } from "@/lib/planner/breakQueries";
import { resolveDisplayName } from "@/lib/profile/displayName";
import type { SubjectAnalytics } from "@/lib/profile/analytics";
import { Suspense, lazy, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

/**
 * Everything the Portal draws about one child. A real parent's page reads it
 * from the database; the showcase passes its fixture child in whole.
 */
export interface PortalData {
  parentName: string;
  childName: string;
  level: string | null;
  enrolments: ChildEnrolment[];
  analytics: SubjectAnalytics[];
  trends: WeeklyTrendPoint[];
  trendSubjects: string[];
  engagement: ChildEngagement | undefined;
  feedback: FeedbackItem[];
  week: ChildWeekSubject[];
  sessions: UpcomingSession[];
}

/**
 * @param demo The showcase's fixture child. Only the /demo route passes it, the
 *   way the student showcase passes its week plan: the fixtures stay in the demo
 *   route, the page reads nothing for it, and the parts that need a session
 *   (the break card, messages) stay out.
 */
export function ParentDashboard({ demo }: { demo?: PortalData } = {}) {
  const { email } = useRoles();
  const { displayName: profileName } = useEnrolments();
  const queryClient = useQueryClient();

  // Which child is being viewed. A parent with several children gets a
  // switcher, and Back comes back to the one they had picked, as long as it
  // is still linked: a child unlinked since used to come back as an error.
  const childrenQ = useChildLinks(!demo);
  const children = childrenQ.data ?? EMPTY_CHILDREN;
  const [pickedChildId, setPickedChildId] = useEntryState<string | null>("portal.child", null);
  const selectedChild = demo
    ? null
    : (children.find((c) => c.student_id === pickedChildId) ?? children[0] ?? null);
  const childId = selectedChild?.student_id ?? null;
  const childName = selectedChild
    ? resolveDisplayName(selectedChild.display_name, selectedChild.email)
    : "your child";

  // Real data, all keyed by the selected child. In the showcase there is no
  // child id, so every read stays off.
  const enrolmentsQ = useChildEnrolments(childId);
  const childEnrolments = enrolmentsQ.data ?? EMPTY_ENROLMENTS;
  const childSubjects = useMemo(() => childEnrolments.map((e) => e.subject), [childEnrolments]);
  const courseQ = useChildCourse(childId);
  const analyticsQ = useAnalytics(childId, childSubjects);
  const trendsQ = useChildTrends(childId);
  const engagementQ = useChildEngagement(childId, childSubjects, courseQ.data);
  const feedbackQ = useChildFeedback(childId);
  const weekQ = useChildWeek(childId, childEnrolments);
  const sessionsQ = useChildUpcomingSessions(childId, childEnrolments, courseQ.data?.level);
  // The break card's own read, waited for here so a break doesn't land on top
  // of a page that has already drawn.
  const breaksQ = useQuery({ ...studentBreaksQuery(childId ?? ""), enabled: !!childId });

  const data: PortalData = demo ?? {
    parentName: resolveDisplayName(profileName, email),
    childName,
    level: courseQ.data?.level ?? null,
    enrolments: childEnrolments,
    analytics: analyticsQ.rows,
    trends: trendsQ.data ?? EMPTY_TRENDS,
    trendSubjects: childSubjects,
    engagement: engagementQ.data,
    feedback: feedbackQ.data ?? EMPTY_FEEDBACK,
    week: weekQ.data ?? EMPTY_WEEK,
    sessions: sessionsQ.data ?? EMPTY_SESSIONS,
  };
  const hasChild = !!demo || !!childId;

  // Without the child's subjects and course there is nothing to lay out but the
  // note (and Messages, which need neither).
  const courseError = demo ? null : (enrolmentsQ.error ?? courseQ.error ?? null);
  // A failed section says so above the rest, which still draws. One failed
  // read used to replace the whole page, Messages included, and before that
  // fell through to the empty copy, telling a parent their child had done no
  // work when the request had simply not come back.
  const sectionError = demo
    ? null
    : ([analyticsQ, trendsQ, engagementQ, feedbackQ, weekQ, sessionsQ].find((q) => q.error)
        ?.error ?? null);
  // Every failed read once: the grades, the trend and the feedback share one.
  const retryFailed = () =>
    void queryClient.refetchQueries({
      type: "active",
      predicate: (q) => q.state.status === "error",
    });
  // One wait for the whole page, so nothing pops in once it has drawn: the side
  // column arriving late squeezed the grade cards from full width to two
  // thirds, and "This week" pushed the chart down.
  const loading =
    !demo &&
    (analyticsQ.loading ||
      [
        childrenQ,
        enrolmentsQ,
        courseQ,
        trendsQ,
        engagementQ,
        feedbackQ,
        weekQ,
        sessionsQ,
        breaksQ,
      ].some((q) => q.isLoading));

  const showEngagement =
    !!data.engagement && (data.engagement.sessionsHeld > 0 || data.engagement.homeworkSet > 0);
  const showSide = showEngagement || data.feedback.length > 0 || data.sessions.length > 0;

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
              <h2 className="text-lg font-bold tracking-tight break-words text-white sm:text-xl">
                Welcome back, {data.parentName}
              </h2>
            </div>
            {/* The child's course, as their own ribbon states it. */}
            {hasChild && data.enrolments.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-primary-foreground/70 text-xs font-semibold">
                  {data.childName}
                </span>
                <EnrolmentSummary enrolments={data.enrolments} level={data.level} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Child switcher — only when there's a choice to make. */}
      {!demo && children.length > 1 && (
        <div className="mb-6">
          <SegmentedToggle
            layoutId="parent-child-toggle"
            label="Child"
            value={childId ?? ""}
            onChange={setPickedChildId}
            items={children.map((c) => ({
              value: c.student_id,
              label: resolveDisplayName(c.display_name, c.email),
            }))}
          />
        </div>
      )}

      {childrenQ.error ? (
        <ErrorNote error={childrenQ.error} onRetry={() => void childrenQ.refetch()} />
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
      ) : courseError ? (
        <ErrorNote error={courseError} onRetry={retryFailed} />
      ) : !demo && childSubjects.length === 0 ? (
        <EmptyState
          title={`${childName} isn't enrolled yet`}
          body="Their grades, attendance and tutor feedback appear here once they're enrolled in a subject."
          mascot="books"
        />
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className={`space-y-8 ${showSide ? "lg:col-span-2" : "lg:col-span-3"}`}>
            {sectionError && <ErrorNote error={sectionError} onRetry={retryFailed} />}
            {childId && <ChildBreakCard childId={childId} childName={childName.split(" ")[0]} />}
            <div data-tour="parent-grades">
              <GradePredictorCard
                analytics={data.analytics}
                level={data.level}
                grades={data.enrolments}
              />
            </div>
            {data.week.length > 0 && (
              <div data-tour="parent-week">
                <ChildWeekCard weeks={data.week} />
              </div>
            )}
            <div data-tour="parent-trends">
              <Suspense
                fallback={<div className="premium-card bg-secondary/40 h-[22rem] animate-pulse" />}
              >
                <TrendsChart points={data.trends} subjects={data.trendSubjects} />
              </Suspense>
            </div>
          </div>
          {showSide && (
            <div className="space-y-8">
              {data.sessions.length > 0 && (
                <div data-tour="parent-sessions">
                  <UpcomingSessions sessions={data.sessions} />
                </div>
              )}
              {showEngagement && data.engagement && (
                <div data-tour="parent-engagement">
                  <EngagementStats engagement={data.engagement} childName={data.childName} />
                </div>
              )}
              {data.feedback.length > 0 && (
                <div data-tour="parent-feedback">
                  <FeedbackList items={data.feedback} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Real parents only: the showcase has no session to send from. Drawn
          whatever else failed below the child list, so a tutor can always be
          reached. */}
      {childId && !childrenQ.error && !loading && (
        <div className="mt-8">
          <ParentMessages childId={childId} childName={childName} />
        </div>
      )}
    </AppLayout>
  );
}

const EMPTY_CHILDREN: ChildLink[] = [];
const EMPTY_ENROLMENTS: ChildEnrolment[] = [];
const EMPTY_TRENDS: WeeklyTrendPoint[] = [];
const EMPTY_FEEDBACK: FeedbackItem[] = [];
const EMPTY_WEEK: ChildWeekSubject[] = [];
const EMPTY_SESSIONS: UpcomingSession[] = [];
