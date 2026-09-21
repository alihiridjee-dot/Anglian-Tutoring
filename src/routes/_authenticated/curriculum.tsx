import { createFileRoute } from "@tanstack/react-router";
import { guardStudentSection } from "@/lib/auth/routeGuards";
import { validateCurriculumSearch } from "@/lib/curriculum/curriculumParams";
import { Curriculum } from "@/components/curriculum/CurriculumPage";

export const Route = createFileRoute("/_authenticated/curriculum")({
  beforeLoad: guardStudentSection,
  head: () => ({ meta: [{ title: "Curriculum | Anglia Educate" }] }),
  validateSearch: validateCurriculumSearch,
  component: Curriculum,
});
