import { createFileRoute } from "@tanstack/react-router";
import { guardStudentSection } from "@/lib/auth/routeGuards";
import { validateVideoSearch } from "@/lib/curriculum/videoFilters";
import { Videos } from "@/components/curriculum/VideosPage";

export const Route = createFileRoute("/_authenticated/videos")({
  beforeLoad: guardStudentSection,
  head: () => ({ meta: [{ title: "Videos | Anglia Educate" }] }),
  validateSearch: validateVideoSearch,
  component: Videos,
});
