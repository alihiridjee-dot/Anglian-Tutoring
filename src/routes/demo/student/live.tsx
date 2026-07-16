import { createFileRoute } from "@tanstack/react-router";
import { Live } from "@/routes/_authenticated/live";

// Showcase mount: the real page component, rendered outside the auth guard.
// isDemoMode() keys off the /demo/* pathname, so every query inside short-circuits
// to fixtures and no session is ever needed.
export const Route = createFileRoute("/demo/student/live")({
  head: () => ({ meta: [{ title: "Live Lessons | Anglian Learning" }] }),
  component: Live,
});
