import { createFileRoute } from "@tanstack/react-router";
import { guardStudentSection } from "@/lib/auth/routeGuards";
import { MCQs } from "@/components/mcq/McqsPage";

export const Route = createFileRoute("/_authenticated/mcqs")({
  beforeLoad: guardStudentSection,
  head: () => ({ meta: [{ title: "MCQs | Anglia Educate" }] }),
  component: MCQs,
});
