import { useState } from "react";
import { Loader2, Lock, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ErrorNote, SectionHeading, Spinner } from "@/components/Shared";
import { inputCls } from "@/components/tutor/Field";
import {
  useAddStudentNote,
  useDeleteStudentNote,
  useStudentNotes,
  useUpdateStudentNote,
} from "@/hooks/data/useStudents";
import { useRoles } from "@/hooks/useRole";
import type { StudentNote } from "@/lib/students/studentsDal";
import { formatDateTime } from "./studentPresentation";

const textareaCls = `${inputCls} h-auto min-h-24 resize-y py-2`;

function NoteItem({
  note,
  studentId,
  mine,
}: {
  note: StudentNote;
  studentId: string;
  mine: boolean;
}) {
  const update = useUpdateStudentNote();
  const remove = useDeleteStudentNote();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [confirming, setConfirming] = useState(false);
  const busy = update.isPending || remove.isPending;

  return (
    <li className="py-4">
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            update.mutate(
              { noteId: note.id, body: draft, studentId },
              {
                onSuccess: () => {
                  toast.success("Note saved.");
                  setEditing(false);
                },
                onError: (err) => toast.error(err.message),
              },
            );
          }}
          className="space-y-2"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={textareaCls}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="btn-solid inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold"
            >
              {update.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Save
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(note.body);
                setEditing(false);
              }}
              className="btn-soft inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{note.body}</p>
          <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span>
              {formatDateTime(note.created_at)}
              {note.updated_at !== note.created_at && " · edited"}
            </span>
            {mine && !confirming && (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="hover:text-foreground inline-flex items-center gap-1 font-semibold"
                >
                  <Pencil className="size-3" aria-hidden /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="hover:text-foreground inline-flex items-center gap-1 font-semibold"
                >
                  <Trash2 className="size-3" aria-hidden /> Delete
                </button>
              </>
            )}
            {confirming && (
              <span className="inline-flex items-center gap-2">
                Delete this note?
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    remove.mutate(
                      { noteId: note.id, studentId },
                      {
                        onSuccess: () => toast.success("Note deleted."),
                        onError: (err) => toast.error(err.message),
                        onSettled: () => setConfirming(false),
                      },
                    )
                  }
                  className="tint-rose font-bold text-[color:var(--tint)]"
                >
                  Yes, delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="font-semibold"
                >
                  Keep
                </button>
              </span>
            )}
          </div>
        </>
      )}
    </li>
  );
}

/**
 * Private notes on the student. Tutor-only at the database: neither the
 * student nor a linked parent has a policy on the table, so nothing written
 * here can reach them. Anyone on staff can read every note; only its author
 * can change or delete it.
 */
export function StudentNotes({ studentId }: { studentId: string }) {
  const { userId } = useRoles();
  const notes = useStudentNotes(studentId);
  const add = useAddStudentNote();
  const [draft, setDraft] = useState("");

  return (
    <section className="premium-card rounded-2xl p-5 sm:p-6">
      <SectionHeading title="Notes">
        <span className="chip tint-slate inline-flex items-center gap-1 text-[10px]">
          <Lock className="size-3" aria-hidden /> Tutors only
        </span>
      </SectionHeading>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          add.mutate(
            { studentId, body: draft },
            {
              onSuccess: () => setDraft(""),
              onError: (err) => toast.error(err.message),
            },
          );
        }}
        className="mt-4 space-y-2"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Something worth remembering about this student"
          aria-label="New note"
          className={textareaCls}
        />
        <button
          type="submit"
          disabled={add.isPending || !draft.trim()}
          className="btn-solid inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold"
        >
          {add.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Add note
        </button>
      </form>

      {notes.error ? (
        <div className="mt-4">
          <ErrorNote error={notes.error} onRetry={() => void notes.refetch()} />
        </div>
      ) : notes.isPending ? (
        <Spinner className="py-8" />
      ) : notes.data.length > 0 ? (
        <ul className="divide-border mt-4 divide-y">
          {notes.data.map((n) => (
            <NoteItem key={n.id} note={n} studentId={studentId} mine={n.author_id === userId} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
