import { createFileRoute } from "@tanstack/react-router";
import { guardStudentSection } from "@/lib/auth/routeGuards";
import { HomeworkPage } from "@/components/homework/HomeworkPage";

export const Route = createFileRoute("/_authenticated/homework")({
  beforeLoad: guardStudentSection,
  head: () => ({ meta: [{ title: "Homework & Grades | Anglia Educate" }] }),
  component: HomeworkPage,
});
