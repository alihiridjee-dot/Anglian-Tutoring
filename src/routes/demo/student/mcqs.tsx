import { createFileRoute } from "@tanstack/react-router";
import { MCQs } from "@/routes/_authenticated/mcqs";

// Showcase mount: the real page component, rendered outside the auth guard.
// isDemoMode() keys off the /demo/* pathname, so every query inside short-circuits
// to fixtures and no session is ever needed.
export const Route = createFileRoute("/demo/student/mcqs")({
  head: () => ({ meta: [{ title: "Quizzes | Anglian Learning" }] }),
  component: MCQs,
});
