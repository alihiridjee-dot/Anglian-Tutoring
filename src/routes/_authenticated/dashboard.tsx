import { createFileRoute } from "@tanstack/react-router";
import { redirectToRoleHome } from "@/lib/auth/routeGuards";

export const Route = createFileRoute("/_authenticated/dashboard")({
  beforeLoad: redirectToRoleHome,
  component: () => null, // Never rendered due to redirect in beforeLoad
});
