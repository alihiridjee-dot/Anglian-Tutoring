import { createFileRoute } from "@tanstack/react-router";
import { Videos } from "@/routes/_authenticated/videos";

// Showcase mount: the real page component, rendered outside the auth guard.
// isDemoMode() keys off the /demo/* pathname, so every query inside short-circuits
// to fixtures and no session is ever needed.
export const Route = createFileRoute("/demo/student/videos")({
  head: () => ({ meta: [{ title: "Video Library | Anglian Learning" }] }),
  component: Videos,
});
