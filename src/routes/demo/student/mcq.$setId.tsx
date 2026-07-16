import { createFileRoute } from "@tanstack/react-router";
import { TakeMcq } from "@/routes/_authenticated/mcq.$setId";

// Showcase mount: the real page component, rendered outside the auth guard.
// isDemoMode() keys off the /demo/* pathname, so every query inside short-circuits
// to fixtures and no session is ever needed.
export const Route = createFileRoute("/demo/student/mcq/$setId")({
  head: () => ({ meta: [{ title: "Quiz | Anglian Learning" }] }),
  component: TakeMcq,
});
