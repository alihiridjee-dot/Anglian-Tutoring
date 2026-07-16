import { createFileRoute } from "@tanstack/react-router";
import { StudentDashboard } from "@/routes/_authenticated/student-dashboard";

// Showcase mount: the real page component, rendered outside the auth guard.
// isDemoMode() keys off the /demo/* pathname, so every query inside short-circuits
// to fixtures and no session is ever needed.
export const Route = createFileRoute("/demo/student/dashboard")({
  head: () => ({ meta: [{ title: "Student Demo | Anglian Learning" }] }),
  component: StudentDashboard,
});
