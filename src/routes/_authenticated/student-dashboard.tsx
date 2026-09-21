import { createFileRoute } from "@tanstack/react-router";
import { guardStudentHome } from "@/lib/auth/routeGuards";
import { StudentDashboard } from "@/components/dashboard/StudentDashboardPage";

export const Route = createFileRoute("/_authenticated/student-dashboard")({
  beforeLoad: guardStudentHome,
  head: () => ({ meta: [{ title: "Student Dashboard | Anglia Educate" }] }),
  component: StudentDashboard,
});
