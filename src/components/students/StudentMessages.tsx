import { Link } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { EmptyState, ErrorNote, SectionHeading, Spinner } from "@/components/Shared";
import { useStudentThreads } from "@/hooks/data/useStudents";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { timeAgo } from "./studentPresentation";

/** The student's conversations, newest first. Replying happens on Messages. */
export function StudentMessages({ studentId }: { studentId: string }) {
  const q = useStudentThreads(studentId);

  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isPending) return <Spinner label="Loading messages" className="py-12" />;

  if (q.data.length === 0) {
    return (
      <EmptyState
        title="No messages yet"
        body="Conversations this student starts appear here. Threads close after 30 days."
        action={{ to: "/messages", label: "Open messages" }}
        mascot="books"
      />
    );
  }

  return (
    <section className="premium-card rounded-2xl p-5 sm:p-6">
      <SectionHeading title="Conversations">
        <Link
          to="/messages"
          className="btn-soft inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold"
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
                  {t.subject && (
                    <span className={`chip text-[10px] ${SUBJECT_TINT[t.subject] ?? "tint-slate"}`}>
                      {subjectLabel(t.subject)}
                    </span>
                  )}
                  {t.context_label && (
                    <span className="text-muted-foreground text-xs">{t.context_label}</span>
                  )}
                  {t.status !== "open" && (
                    <span className="chip tint-slate text-[10px] capitalize">{t.status}</span>
                  )}
                </div>
              </div>
              <span className="text-muted-foreground text-xs">{timeAgo(t.last_message_at)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
