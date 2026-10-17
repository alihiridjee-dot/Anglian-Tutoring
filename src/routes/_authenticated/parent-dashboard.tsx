import { createFileRoute } from "@tanstack/react-router";
import { guardParentOnly } from "@/lib/auth/routeGuards";
import { ParentDashboard } from "@/components/parent/ParentDashboardPage";

export const Route = createFileRoute("/_authenticated/parent-dashboard")({
  beforeLoad: guardParentOnly,
  // A tutor's reply in the bell links here with ?thread=, to open it.
  validateSearch: (search: Record<string, unknown>): { thread?: string } => ({
    thread: typeof search.thread === "string" ? search.thread : undefined,
  }),
  head: () => ({ meta: [{ title: "Parent Portal | Anglia Educate" }] }),
  component: ParentDashboard,
});
