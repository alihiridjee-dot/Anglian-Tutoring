import { createFileRoute } from "@tanstack/react-router";
import { guardStudentSection } from "@/lib/auth/routeGuards";
import { TakeMcq } from "@/components/mcq/TakeMcqPage";

export const Route = createFileRoute("/_authenticated/mcq/$setId")({
  // A quiz is a student learning section like the list that links to it. Left
  // unguarded, a parent following a shared link could sit the paper and have it
  // filed as an attempt of their own.
  beforeLoad: guardStudentSection,
  head: () => ({ meta: [{ title: "MCQ | Anglia Educate" }] }),
  component: TakeMcq,
});
