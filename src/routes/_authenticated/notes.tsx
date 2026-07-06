import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";

export const Route = createFileRoute("/_authenticated/notes")({
  head: () => ({ meta: [{ title: "Notes | StudyHub" }] }),
  component: Notes,
});

function Notes() {
  return (
    <AppLayout title="Revision Notes">
      <div className="rounded-2xl bg-card border border-border p-8 text-center">
        <p className="text-muted-foreground">
          Personal notes are coming soon. For now, download study materials from{" "}
          <a href="/downloads" className="text-primary hover:underline">
            Downloads
          </a>
          .
        </p>
      </div>
    </AppLayout>
  );
}
