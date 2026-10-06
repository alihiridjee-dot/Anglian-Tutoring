import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { EmptyState, ErrorNote, Spinner } from "@/components/Shared";
import { TopicOrderEditor } from "@/components/planner/TopicOrderEditor";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { usePlannerRoadmap } from "@/hooks/data/usePlanner";
import { useViewerId } from "@/hooks/useViewer";
import { useActiveSubject, useSubjectFromLink } from "@/hooks/useActiveSubject";
import { guardStudentSection } from "@/lib/auth/routeGuards";
import { invalidatePlanner } from "@/lib/planner/queries";
import { isSubject, type SubjectV } from "@/lib/curriculum/taxonomy";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/planner-order")({
  beforeLoad: guardStudentSection,
  validateSearch: (search: Record<string, unknown>): { subject?: SubjectV } => ({
    subject: isSubject(search.subject) ? search.subject : undefined,
  }),
  head: () => ({ meta: [{ title: "Topic order | Anglia Educate" }] }),
  component: TopicOrderPage,
});
function TopicOrderPage() {
  const { subject: requested } = Route.useSearch();
  const { enrolments, level, loading } = useEnrolments();
  const studentId = useViewerId();
  const navigate = useNavigate();
  // The planner links here with its course, which moves the header slider; a
  // bare /planner-order is on the slider's subject. Either way the slider
  // decides from then on, so switching it reorders the other subject.
  const { subject: active } = useActiveSubject();
  useSubjectFromLink(requested, () => void navigate({ to: "/planner-order", replace: true }));
  const chosen = requested ?? active;
  const enrolment = enrolments.find((e) => e.subject === chosen);
  const subject: SubjectV = isSubject(chosen) ? chosen : "biology";
  const course = {
    studentId: studentId ?? "",
    subject,
    board: enrolment?.board ?? "aqa",
    level: level ?? ("gcse" as const),
  };
  const query = usePlannerRoadmap(course, 0, !!studentId && !!enrolment && !!level);
  const client = useQueryClient();
  const back = () => {
    void navigate({ to: "/planner" });
  };
  return (
    <AppLayout title="Change topic order">
      {loading || !studentId || query.isLoading ? (
        <Spinner className="py-12" />
      ) : query.error ? (
        <ErrorNote error={query.error} onRetry={() => void query.refetch()} />
      ) : !enrolment || !level || !query.data ? (
        <EmptyState
          title="No course plan available"
          body="Choose an enrolled subject in your planner first."
        />
      ) : (
        <TopicOrderEditor
          key={`${studentId}:${subject}`}
          data={query.data}
          course={course}
          onCancel={back}
          onSaved={async () => {
            await invalidatePlanner(client, studentId);
            toast.success("Your topic order is saved.");
            back();
          }}
        />
      )}
    </AppLayout>
  );
}
