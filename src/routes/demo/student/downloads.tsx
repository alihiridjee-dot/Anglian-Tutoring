import { createFileRoute } from "@tanstack/react-router";
import { Downloads } from "@/routes/_authenticated/downloads";

// Showcase mount: the real page component, rendered outside the auth guard.
// isDemoMode() keys off the /demo/* pathname, so every query inside short-circuits
// to fixtures and no session is ever needed.
export const Route = createFileRoute("/demo/student/downloads")({
  head: () => ({ meta: [{ title: "Downloads | Anglia Educate" }] }),
  component: Downloads,
});
