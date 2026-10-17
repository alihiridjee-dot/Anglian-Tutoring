import { createFileRoute } from "@tanstack/react-router";
import { ParentDashboard } from "@/components/parent/ParentDashboardPage";
import { DEMO_PORTAL } from "@/components/demo/parentPortalDemo";

// Showcase mount: the real page component, rendered outside the auth guard.
// isDemoMode() keys off the /demo/* pathname, so every query inside short-circuits
// and no session is ever needed.
//
// The child is passed in whole, the way the student showcase passes its week
// plan, so the fixtures live here rather than branched into the live page.
export const Route = createFileRoute("/demo/parent/dashboard")({
  head: () => ({ meta: [{ title: "Parent Portal | Anglia Educate" }] }),
  component: DemoParentDashboard,
});

function DemoParentDashboard() {
  return <ParentDashboard demo={DEMO_PORTAL} />;
}
