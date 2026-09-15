import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { EmptyState, ErrorNote, Spinner } from "@/components/Shared";
import { TopicOrderEditor } from "@/components/planner/TopicOrderEditor";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { usePlannerRoadmap } from "@/hooks/data/usePlanner";
import { getSessionUserId } from "@/lib/auth/session";
import { guardStudentSection } from "@/lib/routeGuards";
import { invalidatePlanner } from "@/lib/planner/queries";
import type { SubjectV, BoardV } from "@/lib/taxonomy";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/planner-order")({
  beforeLoad: guardStudentSection,
  validateSearch: (search: Record<string, unknown>) => ({
    subject: typeof search.subject === "string" ? search.subject : "biology",
  }),
  head: () => ({ meta: [{ title: "Topic order | Anglia Educate" }] }),
  component: TopicOrderPage,
});
function TopicOrderPage() {
  const { subject } = Route.useSearch();
  const { enrolments, level, loading } = useEnrolments();
  const [studentId, setStudentId] = useState<string | null>(null);
  useEffect(() => {
    void getSessionUserId().then(setStudentId);
  }, []);
  const enrolment = enrolments.find((e) => e.subject === subject);
  const course = {
    studentId: studentId ?? "",
    subject: subject as SubjectV,
    board: (enrolment?.board ?? "aqa") as BoardV,
    level: level ?? ("gcse" as const),
  };
  const query = usePlannerRoadmap(course, 0, !!studentId && !!enrolment && !!level);
  const client = useQueryClient();
  const navigate = useNavigate();
  const back = () => {
    void navigate({ to: "/planner" });
  };
  return (
    <AppLayout title="Change topic order">
      {loading || !studentId || query.isLoading ? (
        <Spinner className="py-12" />
      ) : query.error ? (
        <ErrorNote error={query.error} />
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
