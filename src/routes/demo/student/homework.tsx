import { createFileRoute } from "@tanstack/react-router";
import { HomeworkPage } from "@/routes/_authenticated/homework";

// Showcase mount: the real page component, rendered outside the auth guard.
// isDemoMode() keys off the /demo/* pathname, so every query inside short-circuits
// to fixtures and no session is ever needed.
export const Route = createFileRoute("/demo/student/homework")({
  head: () => ({ meta: [{ title: "Homework & Grades | Anglian Learning" }] }),
  component: HomeworkPage,
});
