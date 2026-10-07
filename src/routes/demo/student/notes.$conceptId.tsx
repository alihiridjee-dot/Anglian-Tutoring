import { createFileRoute } from "@tanstack/react-router";
import { NotePage } from "@/components/notes/NotePage";

// Showcase mount: the real page component, rendered outside the auth guard.
// isDemoMode() keys off the /demo/* pathname, so every query inside short-circuits
// to fixtures and no session is ever needed.
export const Route = createFileRoute("/demo/student/notes/$conceptId")({
  head: () => ({ meta: [{ title: "Revision Notes | Anglia Educate" }] }),
  component: NotePage,
});
