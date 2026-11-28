import { useParams, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { EmptyState, Spinner } from "@/components/Shared";
import { NoteView, type NoteCodeLink } from "@/components/notes/NoteView";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useEntitlements } from "@/hooks/data/useEntitlements";
import { usePinSubject } from "@/hooks/useActiveSubject";
import { useNote, useNoteSpecPoints } from "@/hooks/data/useNotes";
import { useOwnCourse } from "@/hooks/useOwnCourse";
import { SUBJECT_LABEL } from "@/lib/curriculum/subjectTheme";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import { curriculumTarget } from "@/lib/search/globalSearch";
import { NOTE_BOARDS, noteLayerFor, pickNoteLayer, subjectOfNoteId } from "@/lib/notes/noteFormat";

export function NotePage() {
  // `strict: false` because this component is mounted twice — under the signed-in
  // routes, and again under /demo/student for the signed-out showcase. Binding the
  // params to one route id would make it readable from only one of them.
  const params = useParams({ strict: false }) as { conceptId?: string };
  const conceptId = params.conceptId ?? "";
  const demo = isDemoStudent();
  // Pending, not `isLoading`: offline the read waits for the network with
  // `isLoading` false and nothing read, and the page said "isn't ready yet".
  const { data: note, isPending, error } = useNote(conceptId);
  const { enrolments, level } = useEnrolments();
  const router = useRouter();
  // A note is about one subject: opening it moves the header slider there, and
  // switching subject from here goes to the curriculum for the new one.
  usePinSubject(note?.subject, () =>
    router.navigate({ to: demo ? "/demo/student/curriculum" : "/curriculum" }),
  );

  // Show the layer for the student's own course (board and level) in this
  // subject. If the note has none, it shows without one: a student is never
  // shown another board's codes or question.
  const enrolled = enrolments.find((e) => e.subject === note?.subject)?.board as string | undefined;
  const layers = note ? NOTE_BOARDS.filter((b) => note.boards[b]) : [];
  const own = noteLayerFor(enrolled, level);
  const board = pickNoteLayer(layers, own, level, !!enrolled);

  // A note without the student's own layer was written for another course,
  // and is turned away, unless a spec point on their own course links to it.
  const course = useOwnCourse();
  const checkLinks = course.guarded && !!note && !!enrolled && !(own && layers.includes(own));
  const links = useNoteSpecPoints(conceptId);
  const offCourse =
    checkLinks && !!links.data && !links.data.some((p) => p.course && course.onCourse(p.course));

  // Each spec code at the top of the note opens its point, where the quizzes
  // and tasks for it are, when that point is on the student's own course.
  const codeLinks = new Map<string, NoteCodeLink>();
  for (const p of links.data ?? []) {
    if (p.course && !course.onCourse(p.course)) continue;
    codeLinks.set(
      p.code,
      curriculumTarget(
        {
          subject: p.course?.subject ?? note?.subject,
          board: p.course?.board,
          level: p.course?.level,
          pointId: p.id,
        },
        demo,
      ),
    );
  }

  // A note in a subject the student doesn't take is hidden from them with the
  // rest of that subject, so it arrives as no note at all. Its id still names
  // the subject, which tells "not on your plan" apart from "not written yet".
  const ent = useEntitlements();
  const idSubject = subjectOfNoteId(conceptId);
  const lockedSubject =
    !demo && idSubject && !ent.loading && !ent.isEntitled(idSubject) ? idSubject : null;

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
              : router.navigate({ to: demo ? "/demo/student/curriculum" : "/curriculum" })
          }
          className="inline-flex items-center gap-1.5 text-sm font-bold"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back
        </button>
        {isPending ||
        (!note && idSubject && !demo && ent.loading) ||
        (note && !course.ready) ||
        (checkLinks && links.isPending) ? (
          <Spinner label="Loading the note" />
        ) : error || (checkLinks && links.error) ? (
          <EmptyState
            compact
            title="This note didn't load"
            body="Check your connection and refresh the page."
          />
        ) : !note && lockedSubject ? (
          <EmptyState
            title={`This note is part of ${SUBJECT_LABEL[lockedSubject]}`}
            body={`${SUBJECT_LABEL[lockedSubject]} isn't on your plan yet.`}
            action={{ to: "/billing", label: `Add ${SUBJECT_LABEL[lockedSubject]} to your plan` }}
            mascot="books"
          />
        ) : !note && !idSubject ? (
          <EmptyState
            title="There's no note at this link"
            body="Check the link, or open a note from its spec point in the curriculum."
            action={{
              to: demo ? "/demo/student/curriculum" : "/curriculum",
              label: "Go to the curriculum",
            }}
            mascot="books"
          />
        ) : !note ? (
          <EmptyState
            title="This note isn't ready yet"
            body="It will appear here as soon as it's published."
            mascot="books"
          />
        ) : offCourse ? (
          <EmptyState
            title="This note isn't on your course"
            action={{
              to: demo ? "/demo/student/curriculum" : "/curriculum",
              label: "Go to the curriculum",
            }}
            mascot="books"
          />
        ) : (
          <NoteView note={note} board={board} codeLinks={codeLinks} />
        )}
      </div>
    </AppLayout>
  );
}
