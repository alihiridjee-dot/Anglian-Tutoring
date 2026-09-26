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
import { Spinner } from "@/components/Shared";
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

  const { rows: analytics, loading } = useAnalytics(studentId, subjects);
  const { data: trends = [] } = useChildTrends(studentId);
  const { data: engagement } = useChildEngagement(studentId, subjects, {
    level: record.profile.level,
    joinedAt: record.profile.created_at,
  });
  const { data: feedback = [] } = useChildFeedback(studentId, 8);

  if (loading) return <Spinner label="Loading performance" className="py-12" />;

  return (
    <div className="space-y-6">
      <GradePredictorCard analytics={analytics} level={record.profile.level} />
      <TrendsChart points={trends} subjects={subjects} />
      <div className="grid gap-6 lg:grid-cols-2">
        {engagement && <EngagementStats engagement={engagement} childName={name} />}
        <FeedbackList items={feedback} />
      </div>
    </div>
  );
}
