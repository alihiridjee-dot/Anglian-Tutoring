import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { PageHeader, Spinner } from "@/components/Shared";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";
import { StudentsRoster } from "@/components/students/StudentsRoster";

export const Route = createFileRoute("/_authenticated/students")({
  head: () => ({ meta: [{ title: "Students | Anglia Educate" }] }),
  component: Students,
});

/**
 * The roster. Each row opens the student's record, where everything about them
 * — course, performance, homework, quizzes, plan, messages, notes — lives.
 */
function Students() {
  const { isTutor, loading: rolesLoading } = useRoles();

  if (rolesLoading)
    return (
      <AppLayout title="Students">
        <Spinner />
      </AppLayout>
    );
  if (!isTutor) {
    return (
      <AppLayout title="Students">
        <p className="text-muted-foreground">Tutor access required.</p>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Students">
      <div className="mb-6">
        <PageHeader
          eyebrow="Tutor workspace"
          title="Students"
          lede="Every student on the platform. Open one to see their course, work, plan and family, and to make changes."
          icon={Users}
        />
      </div>
      <StudentsRoster />
    </AppLayout>
  );
}
