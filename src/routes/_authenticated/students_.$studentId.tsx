import { createFileRoute } from "@tanstack/react-router";
import { Spinner } from "@/components/Shared";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";
import { StudentRecordPage } from "@/components/students/StudentRecordPage";
import { isStudentTab, type StudentTab } from "@/components/students/studentTabs";

export const Route = createFileRoute("/_authenticated/students_/$studentId")({
  // `section`, not `tab`: the planner already uses `?tab=` with its own values,
  // and the router unions every route's search shape for untyped navigation.
  validateSearch: (search: Record<string, unknown>): { section?: StudentTab } => ({
    section: isStudentTab(search.section) ? search.section : undefined,
  }),
  head: () => ({ meta: [{ title: "Student | Anglia Educate" }] }),
  component: StudentRoute,
});

function StudentRoute() {
  const { studentId } = Route.useParams();
  const { section } = Route.useSearch();
  const { isTutor, loading: rolesLoading } = useRoles();

  if (rolesLoading)
    return (
      <AppLayout title="Student">
        <Spinner />
      </AppLayout>
    );
  if (!isTutor) {
    return (
      <AppLayout title="Student">
        <p className="text-muted-foreground">Tutor access required.</p>
      </AppLayout>
    );
  }

  return <StudentRecordPage studentId={studentId} tab={section ?? "overview"} />;
}
