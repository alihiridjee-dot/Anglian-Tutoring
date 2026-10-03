import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { EmptyState, Spinner } from "@/components/Shared";
import { NoteView } from "@/components/notes/NoteView";
import { guardStudentSection } from "@/lib/auth/routeGuards";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useNote } from "@/hooks/data/useNotes";
import { NOTE_BOARDS, type NoteBoard } from "@/lib/notes/noteFormat";

export const Route = createFileRoute("/_authenticated/notes_/$conceptId")({
  beforeLoad: guardStudentSection,
  head: () => ({ meta: [{ title: "Revision Notes | Anglia Educate" }] }),
  component: NotePage,
});

function NotePage() {
  const { conceptId } = Route.useParams();
  const { data: note, isLoading, error } = useNote(conceptId);
  const { enrolments } = useEnrolments();
  const router = useRouter();

  // Show the layer for the student's own board in this subject; fall back to
  // whichever board the note has, so a note is never blank.
  const enrolled = enrolments.find((e) => e.subject === note?.subject)?.board as string | undefined;
  const boards = note ? NOTE_BOARDS.filter((b) => note.boards[b]) : [];
  const board: NoteBoard | undefined = boards.find((b) => b === enrolled) ?? boards[0];

  return (
    <AppLayout title="Revision Notes">
      <div className="mx-auto max-w-4xl space-y-4">
        {/* Back to wherever the note was opened from — a curriculum point or the
            week's plan. A note opened from a shared link has nowhere to go back
            to, so it lands on the curriculum. */}
        <button
          type="button"
          onClick={() =>
            router.history.canGoBack()
              ? router.history.back()
              : router.navigate({ to: "/curriculum" })
          }
          className="inline-flex items-center gap-1.5 text-sm font-bold"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back
        </button>
        {isLoading ? (
          <Spinner label="Loading the note" />
        ) : error ? (
          <EmptyState
            compact
            title="This note didn't load"
            body="Check your connection and refresh the page."
          />
        ) : !note || !board ? (
          <EmptyState
            title="This note isn't ready yet"
            body="It will appear here as soon as it's published."
            mascot="books"
          />
        ) : (
          <NoteView note={note} board={board} />
        )}
      </div>
    </AppLayout>
  );
}
