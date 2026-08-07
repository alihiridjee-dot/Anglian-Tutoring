import { createFileRoute } from "@tanstack/react-router";
import { StudentDashboard } from "@/routes/_authenticated/student-dashboard";
import { DemoSalesChat } from "@/components/demo/DemoSalesChat";

// Showcase mount: the real page component, rendered outside the auth guard.
// isDemoMode() keys off the /demo/* pathname, so every query inside short-circuits
// to fixtures and no session is ever needed.
//
// The one addition is the sales chat, passed through the dashboard's slot rather
// than branched into its body — a visitor exploring the product should be able to
// ask about it from the page they're looking at, and a real student should never
// see a "talk to sales" box on their own dashboard.
export const Route = createFileRoute("/demo/student/dashboard")({
  head: () => ({ meta: [{ title: "Student Demo | Anglia Educate" }] }),
  component: DemoStudentDashboard,
});

function DemoStudentDashboard() {
  return <StudentDashboard afterContent={<DemoSalesChat />} />;
}
