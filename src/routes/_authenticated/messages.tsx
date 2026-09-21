import { Mascot } from "@/components/Doodles";
import { ErrorNote, Spinner } from "@/components/Shared";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { guardStudentSection } from "@/lib/routeGuards";
import { useRoles } from "@/hooks/useRole";
import { useChatThreads, type ThreadSummary } from "@/hooks/data/useChat";
import { ThreadList } from "@/components/chat/ThreadList";
import { ThreadView } from "@/components/chat/ThreadView";
import { NewThreadDialog } from "@/components/chat/NewThreadDialog";

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  // Open the most recent conversation on arrival, and again when the open one is
  // deleted — an empty right-hand pane next to a full list is a dead end.
  //
  // "Not in the list" has two meanings, and only one of them is "deleted". A
  // thread that was just created isn't in the list either until the refetch
  // lands, and treating that as a deletion bounced the student out of the
  // question they had just asked and into their previous conversation — where a
  // follow-up would have gone to the wrong thread. So only a selection that
  // *has been seen* in the list, and has now gone, is replaced.
  const seenIds = useRef(new Set<string>());
  useEffect(() => {
    if (selectedId && threads.some((t) => t.id === selectedId)) {
      seenIds.current.add(selectedId);
      return;
    }
    if (selectedId && !seenIds.current.has(selectedId)) return;
    if (threads.length > 0) setSelectedId(threads[0].id);
  }, [threads, selectedId]);

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
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">
              {isTutor
                ? unreadTotal > 0
                  ? `${unreadTotal} message${unreadTotal === 1 ? "" : "s"} waiting for a reply.`
                  : "Everything's answered."
                : "Ask your tutor anything — attach the spec point, homework or quiz you're stuck on."}
            </p>
          </div>
          {!isTutor && (
            <button
              data-guide="ask-question"
              onClick={() => setComposing(true)}
              className="btn-hero inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-sm"
            >
              <MessageSquarePlus className="size-4" aria-hidden /> Ask a question
            </button>
          )}
        </div>

        {error && threads.length === 0 ? (
          // Nothing to fall back on, so say so — not "No conversations yet",
          // which is a claim about the inbox that a failed request can't make.
          <ErrorNote error={error} onRetry={() => void refetch()} />
        ) : threads.length === 0 ? (
          <div className="pop-card p-10 text-center">
            <Mascot name="owl" mood="happy" size={104} className="mx-auto mb-4" />
            <h2 className="font-display text-xl font-extrabold">
              {isTutor ? "No questions yet" : "No conversations yet"}
            </h2>
            <p className="text-muted-foreground mx-auto mt-2 max-w-sm text-sm leading-relaxed">
              {isTutor
                ? "When a student asks a question it lands here, with the spec point or homework they were working on attached."
                : "Stuck on something? Ask your tutor — they'll see exactly which part of the spec you mean."}
            </p>
            {!isTutor && (
              <button
                data-guide="ask-question"
                onClick={() => setComposing(true)}
                className="btn-hero mt-6 inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm"
              >
                <MessageSquarePlus className="size-4" aria-hidden /> Ask a question
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
            <div
              data-guide="message-list"
              className="pop-card scroll-slim max-h-[70vh] overflow-y-auto"
            >
              <ThreadList
                threads={threads}
                selectedId={selectedId}
                onSelect={setSelectedId}
                showCounterpart={isTutor}
              />
            </div>
            <div
              data-guide="message-thread"
              className="premium-card h-[70vh] overflow-hidden rounded-2xl"
            >
              {selected && userId ? (
                <ThreadView thread={selected} viewerId={userId} isTutor={isTutor} />
              ) : (
                <p className="p-10 text-center text-sm text-muted-foreground">
                  Pick a conversation.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {composing && (
        <NewThreadDialog
          onClose={() => setComposing(false)}
          onCreated={(id) => {
            setComposing(false);
            setSelectedId(id);
          }}
        />
      )}
    </AppLayout>
  );
}
