import { createFileRoute } from "@tanstack/react-router";
import { Curriculum } from "@/routes/_authenticated/curriculum";
import { validateCurriculumSearch } from "@/lib/curriculumParams";

// Showcase mount: the real page component, rendered outside the auth guard.
// isDemoMode() keys off the /demo/* pathname, so every query inside short-circuits
// to fixtures and no session is ever needed.
//
// The search params are validated with the same function as the live route, so
// a spec point deep-link behaves identically on both mounts.
export const Route = createFileRoute("/demo/student/curriculum")({
  head: () => ({ meta: [{ title: "Curriculum | Anglia Educate" }] }),
  validateSearch: validateCurriculumSearch,
  component: Curriculum,
});
