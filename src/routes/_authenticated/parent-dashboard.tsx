import { createFileRoute } from "@tanstack/react-router";
import { guardParentOnly } from "@/lib/auth/routeGuards";
import { ParentDashboard } from "@/components/parent/ParentDashboardPage";

export const Route = createFileRoute("/_authenticated/parent-dashboard")({
  beforeLoad: guardParentOnly,
  head: () => ({ meta: [{ title: "Parent Portal | Anglia Educate" }] }),
  component: ParentDashboard,
});

/* ---------- Demo fixtures: only the session-less /demo/* showcase sees these.
   A real parent session below this block renders live data exclusively. ---- */
