import { createFileRoute } from "@tanstack/react-router";
import { Spinner } from "@/components/Shared";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";
import { StudentRecordPage } from "@/components/students/StudentRecordPage";
import { isStudentTab, type StudentTab } from "@/components/students/studentTabs";

export const Route = createFileRoute("/_authenticated/students_/$studentId")({
  validateSearch: (search: Record<string, unknown>): { tab?: StudentTab } => ({
    tab: isStudentTab(search.tab) ? search.tab : undefined,
  }),
  head: () => ({ meta: [{ title: "Student | Anglia Educate" }] }),
  component: StudentRoute,
});

function StudentRoute() {
  const { studentId } = Route.useParams();
  const { tab } = Route.useSearch();
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

  return <StudentRecordPage studentId={studentId} tab={tab ?? "overview"} />;
}
