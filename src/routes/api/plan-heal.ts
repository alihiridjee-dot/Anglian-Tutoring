import { createFileRoute } from "@tanstack/react-router";
import { handlePlanHealRequest } from "@/lib/planner/planHeal.server";

// The nightly plan check: pg_cron posts here once a night, and every saved
// week that has fallen behind its student's full plan is re-cut. Server only.
// With no component, the route never reaches the browser's bundle. Every
// method goes to the one handler, which refuses anything but POST.
export const Route = createFileRoute("/api/plan-heal")({
  server: {
    handlers: {
      ANY: ({ request }) => handlePlanHealRequest(request),
    },
  },
});
