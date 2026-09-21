import { createFileRoute } from "@tanstack/react-router";
import { HomeworkSheetPage } from "@/components/homework/HomeworkSheetPage";

// Showcase mount: the real page component, rendered outside the auth guard.
// isDemoMode() keys off the /demo/* pathname, so every query inside short-circuits
// to fixtures and no session is ever needed.
export const Route = createFileRoute("/demo/student/homework_/$homeworkId")({
  head: () => ({ meta: [{ title: "Homework | Anglia Educate" }] }),
  component: HomeworkSheetPage,
});
