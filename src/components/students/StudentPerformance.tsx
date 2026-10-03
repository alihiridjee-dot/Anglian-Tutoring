import { useAnalytics } from "@/hooks/data/useAnalytics";
import {
  useChildEngagement,
  useChildFeedback,
  useChildTrends,
} from "@/hooks/data/useChildProgress";
import { EngagementStats } from "@/components/parent/EngagementStats";
import { FeedbackList } from "@/components/parent/FeedbackList";
import { GradePredictorCard } from "@/components/parent/GradePredictorCard";
import { TrendsChart } from "@/components/parent/TrendsChart";
import { ErrorNote, Spinner } from "@/components/Shared";
import type { StudentRecord } from "@/lib/students/studentsDal";

/**
 * The same four cards a linked parent sees — predicted grades, weekly trend,
 * engagement, recent feedback — pointed at the student a tutor has open. The
 * hooks are identity-agnostic and RLS already lets a tutor read every table
 * they touch, so nothing here is new; it is the parent view, reused.
 */
export function StudentPerformance({ record, name }: { record: StudentRecord; name: string }) {
  const studentId = record.profile.id;
  const subjects = record.enrolments.map((e) => e.subject);

  const analyticsQ = useAnalytics(studentId, subjects);
  const trendsQ = useChildTrends(studentId);
  const engagementQ = useChildEngagement(studentId, subjects, {
    level: record.profile.level,
    joinedAt: record.profile.created_at,
  });
  const feedbackQ = useChildFeedback(studentId, 8);
  const { rows: analytics, loading } = analyticsQ;
  const trends = trendsQ.data ?? [];
  const engagement = engagementQ.data;
  const feedback = feedbackQ.data ?? [];

  // A failed read rendered as blank or half-blank cards, which reads as "no
  // work done" (M-32). Say so instead, and retry only what failed.
  const error = analyticsQ.error ?? trendsQ.error ?? engagementQ.error ?? feedbackQ.error;
  if (error) {
    const retry = () => {
      for (const q of [analyticsQ, trendsQ, engagementQ, feedbackQ]) if (q.error) void q.refetch();
    };
    return <ErrorNote error={error} onRetry={retry} />;
  }
  if (loading) return <Spinner label="Loading performance" className="py-12" />;

  return (
    <div className="space-y-6">
      <GradePredictorCard
        analytics={analytics}
        level={record.profile.level}
        grades={record.enrolments}
      />
      <TrendsChart points={trends} subjects={subjects} />
      <div className="grid gap-6 lg:grid-cols-2">
        {engagement && <EngagementStats engagement={engagement} childName={name} />}
        <FeedbackList items={feedback} />
      </div>
    </div>
  );
}
