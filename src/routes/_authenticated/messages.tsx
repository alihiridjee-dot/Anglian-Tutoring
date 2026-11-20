import { ErrorNote, Spinner } from "@/components/Shared";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, MessageSquarePlus } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { guardStudentSection } from "@/lib/auth/routeGuards";
import { useRoles } from "@/hooks/useRole";
import { useChatThreads, usePinnedThread, type ThreadSummary } from "@/hooks/data/useChat";
import { ThreadList } from "@/components/chat/ThreadList";
import { ThreadView } from "@/components/chat/ThreadView";
import { NewThreadDialog } from "@/components/chat/NewThreadDialog";
import { EmptyInbox } from "@/components/chat/EmptyInbox";

/**
 * Messages — one route, both sides of the same conversation.
 *
 * A student writes questions here and a tutor answers them, so the page is a
 * list plus a thread for everyone; the only differences are who can start a
 * conversation (students) and who gets the AI draft button (tutors). Keeping it
 * as one route rather than two means the two views cannot drift apart, which is
 * the failure mode that matters for a messaging surface.
 *
 * Parents are bounced by guardStudentSection, the same as the other student
 * learning sections: their child's conversation with a tutor is surfaced
 * through the Parent Portal's own summaries, not read over their shoulder here.
 */
export const Route = createFileRoute("/_authenticated/messages")({
  beforeLoad: guardStudentSection,
  head: () => ({ meta: [{ title: "Messages | Anglia Educate" }] }),
  component: MessagesPage,
});

/** One identity for "no threads", so the selection effect isn't re-run by every render. */
const EMPTY_THREADS: ThreadSummary[] = [];

function MessagesPage() {
  const { isTutor, userId, loading: rolesLoading } = useRoles();
  const { data: threads = EMPTY_THREADS, isPending, error, refetch } = useChatThreads();
  const [composing, setComposing] = useState(false);
  // On a phone the list and the thread take turns in one column; picking a row
  // opens the thread and the back arrow returns to the list. Wide screens show
  // both and ignore this.
  const [threadOpen, setThreadOpen] = useState(false);

  // Open the most recent conversation on arrival, and again when the open one is
  // deleted — an empty right-hand pane next to a full list is a dead end. On a
  // phone that pane is hidden until a row is tapped, and ThreadView leaves it
  // unread until then.
  const [selectedId, setSelectedId] = usePinnedThread(threads);

  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId],
  );
  const unreadTotal = threads.reduce((n, t) => n + t.unread, 0);

  if (rolesLoading || isPending) {
    return (
      <AppLayout title="Messages">
        <Spinner label="Loading your messages" />
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Messages">
      <div className="max-w-6xl">
        {error && threads.length === 0 ? (
          // Nothing to fall back on, so say so — not "No conversations yet",
          // which is a claim about the inbox that a failed request can't make.
          <ErrorNote error={error} onRetry={() => void refetch()} />
        ) : threads.length === 0 ? (
          <EmptyInbox isTutor={isTutor} onAsk={() => setComposing(true)} />
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <p className="min-w-0 flex-1 basis-64 text-lg font-medium">
                {isTutor
                  ? unreadTotal > 0
                    ? `${unreadTotal} message${unreadTotal === 1 ? "" : "s"} waiting for a reply`
                    : "Everything's answered"
                  : "Ask your tutor anything — attach the spec point, task or quiz you're stuck on"}
              </p>
              {!isTutor && (
                <button
                  data-guide="ask-question"
                  onClick={() => setComposing(true)}
                  className="btn-solid inbox-ask inline-flex h-12 shrink-0 items-center gap-2 rounded-xl px-5 text-base font-extrabold"
                >
                  <MessageSquarePlus className="inbox-ask-icon size-5" aria-hidden /> Ask a question
                </button>
              )}
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
              <div
                data-guide="message-list"
                className={`pop-card scroll-slim max-h-[70vh] overflow-y-auto ${threadOpen ? "max-lg:hidden" : ""}`}
              >
                <ThreadList
                  threads={threads}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setThreadOpen(true);
                  }}
                  showCounterpart={isTutor}
                />
              </div>
              {/* Open on a phone turned sideways, the thread takes the whole
                screen (`.thread-sideways`) and its own title row carries the
                way back, so this row steps aside there. */}
              <div
                data-guide="message-thread"
                className={`premium-card flex h-[70vh] min-h-0 flex-col overflow-hidden rounded-2xl ${threadOpen ? "thread-sideways" : "max-lg:hidden"}`}
              >
                <button
                  type="button"
                  onClick={() => setThreadOpen(false)}
                  className="inline-flex min-h-11 items-center gap-2 border-b border-border px-4 text-sm font-semibold text-muted-foreground hover:text-foreground lg:hidden short:hidden"
                >
                  <ArrowLeft className="size-4" aria-hidden /> All conversations
                </button>
                <div className="min-h-0 flex-1">
                  {selected && userId ? (
                    // Keyed by thread: an AI draft or a send still in flight
                    // when the tutor switches finishes in the old, unmounted
                    // view instead of filling the next student's reply box.
                    <ThreadView
                      key={selected.id}
                      thread={selected}
                      viewerId={userId}
                      isTutor={isTutor}
                      onBack={() => setThreadOpen(false)}
                    />
                  ) : (
                    <p className="p-10 text-center text-sm text-muted-foreground">
                      Pick a conversation.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {composing && (
        <NewThreadDialog
          onClose={() => setComposing(false)}
          onCreated={(id) => {
            setComposing(false);
            setSelectedId(id);
            setThreadOpen(true);
          }}
        />
      )}
    </AppLayout>
  );
}
