import { createFileRoute } from "@tanstack/react-router";
import { Videos } from "@/components/curriculum/VideosPage";

export const Route = createFileRoute("/_authenticated/videos")({
  head: () => ({ meta: [{ title: "Videos | Anglia Educate" }] }),
  component: Videos,
});
