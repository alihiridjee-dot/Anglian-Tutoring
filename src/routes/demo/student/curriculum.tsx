import { createFileRoute } from "@tanstack/react-router";
import { Curriculum } from "@/routes/_authenticated/curriculum";

// Showcase mount: the real page component, rendered outside the auth guard.
// isDemoMode() keys off the /demo/* pathname, so every query inside short-circuits
// to fixtures and no session is ever needed.
export const Route = createFileRoute("/demo/student/curriculum")({
  head: () => ({ meta: [{ title: "Curriculum | Anglian Learning" }] }),
  component: Curriculum,
});
