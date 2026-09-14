import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";

export const Route = createFileRoute("/_authenticated/notes")({
  head: () => ({ meta: [{ title: "Notes | Anglia Educate" }] }),
  component: Notes,
});

function Notes() {
  return (
    <AppLayout title="Revision Notes">
      <div className="rounded-2xl premium-card p-8 text-center">
        <p className="text-muted-foreground">
          Personal notes are coming soon. In the meantime, your week&rsquo;s videos, quizzes and
          homework are all on your{" "}
          <a href="/student-dashboard" className="text-primary hover:underline">
            dashboard
          </a>
          .
        </p>
      </div>
    </AppLayout>
  );
}
