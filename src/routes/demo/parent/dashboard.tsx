import { createFileRoute } from "@tanstack/react-router";
import { ParentDashboard } from "@/routes/_authenticated/parent-dashboard";

// Showcase mount: the real page component, rendered outside the auth guard.
// isDemoMode() keys off the /demo/* pathname, so every query inside short-circuits
// to fixtures and no session is ever needed.
export const Route = createFileRoute("/demo/parent/dashboard")({
  head: () => ({ meta: [{ title: "Parent Portal | Anglian Learning" }] }),
  component: ParentDashboard,
});
