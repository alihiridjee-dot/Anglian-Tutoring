import { createFileRoute } from "@tanstack/react-router";
import { NotePage } from "@/components/notes/NotePage";
import { guardStudentSection } from "@/lib/auth/routeGuards";

export const Route = createFileRoute("/_authenticated/notes_/$conceptId")({
  beforeLoad: guardStudentSection,
  head: () => ({ meta: [{ title: "Revision Notes | Anglia Educate" }] }),
  component: NotePage,
});
