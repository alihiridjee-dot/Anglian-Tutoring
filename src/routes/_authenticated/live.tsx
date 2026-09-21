import { createFileRoute } from "@tanstack/react-router";
import { guardStudentSection } from "@/lib/auth/routeGuards";
import { Live } from "@/components/live/LivePage";

export const Route = createFileRoute("/_authenticated/live")({
  beforeLoad: guardStudentSection,
  head: () => ({ meta: [{ title: "Live Sessions | Anglia Educate" }] }),
  component: Live,
});
