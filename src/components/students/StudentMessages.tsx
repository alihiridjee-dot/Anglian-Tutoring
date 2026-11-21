import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { MessageSquarePlus, MessagesSquare } from "lucide-react";
import { EmptyState, ErrorNote, SectionHeading, Spinner } from "@/components/Shared";
import { TutorNewThreadDialog } from "@/components/chat/TutorNewThreadDialog";
import { useStudentThreads } from "@/hooks/data/useStudents";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { timeAgo } from "./studentPresentation";

/**
 * The student's conversations, newest first. Replying happens on Messages; a
 * new one to the student or a parent can be started here.
 */
export function StudentMessages({ studentId }: { studentId: string }) {
  const q = useStudentThreads(studentId);
  const [composing, setComposing] = useState(false);

  const dialog = composing && (
    <TutorNewThreadDialog
      studentId={studentId}
      onClose={() => setComposing(false)}
      onCreated={() => setComposing(false)}
    />
  );

  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isPending) return <Spinner label="Loading messages" className="py-12" />;

  if (q.data.length === 0) {
    return (
      <>
        <EmptyState
          title="No messages yet"
          body="Conversations with this student or their parents appear here. Threads close after 30 days."
          action={{ onClick: () => setComposing(true), label: "Write a message" }}
          mascot="books"
        />
        {dialog}
      </>
    );
  }

  return (
    <section className="premium-card rounded-2xl p-5 sm:p-6">
      <SectionHeading title="Conversations">
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="btn-soft inline-flex h-11 sm:pointer-fine:h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold"
        >
          <MessageSquarePlus className="size-4" aria-hidden /> Write a message
        </button>
        <Link
          to="/messages"
          className="btn-soft inline-flex h-11 sm:pointer-fine:h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold"
        >
          <MessagesSquare className="size-4" aria-hidden /> Open messages
        </Link>
      </SectionHeading>
      <ul className="divide-border mt-2 divide-y">
        {q.data.map((t) => {
          const unread = new Date(t.last_message_at) > new Date(t.tutor_last_read_at ?? 0);
          return (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {unread && (
                    <span
                      className="bg-[color:var(--tint)] tint-primary size-2 shrink-0 rounded-full"
                      aria-label="Unread"
                    />
                  )}
                  <span className="truncate">{t.subject_line}</span>
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {t.about_student_id && (
                    // "With", not "From": a tutor can now write to a parent first.
                    <span className="chip tint-amber text-[10px]">With a parent</span>
                  )}
                  {t.subject && (
                    <span className={`chip text-[10px] ${SUBJECT_TINT[t.subject] ?? "tint-slate"}`}>
                      {subjectLabel(t.subject)}
                    </span>
                  )}
                  {t.context_label && (
                    <span className="chip tint-slate text-[10px]">{t.context_label}</span>
                  )}
                  {t.status !== "open" && (
                    <span className="chip tint-slate text-[10px] capitalize">{t.status}</span>
                  )}
                </div>
              </div>
              <span className="text-xs font-semibold">{timeAgo(t.last_message_at)}</span>
            </li>
          );
        })}
      </ul>
      {dialog}
    </section>
  );
}
