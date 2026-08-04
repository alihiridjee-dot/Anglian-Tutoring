import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, MessageSquarePlus, MessagesSquare } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { guardStudentSection } from "@/lib/routeGuards";
import { useRoles } from "@/hooks/useRole";
import { useChatThreads } from "@/hooks/data/useChat";
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

function MessagesPage() {
  const { isTutor, userId, loading: rolesLoading } = useRoles();
  const { data: threads = [], isPending } = useChatThreads();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  // Open the most recent conversation on arrival — an empty right-hand pane next
  // to a full list is a dead end, especially for a tutor working through an inbox.
  useEffect(() => {
    if (!selectedId && threads.length > 0) setSelectedId(threads[0].id);
  }, [threads, selectedId]);

  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId],
  );
  const unreadTotal = threads.reduce((n, t) => n + t.unread, 0);

  if (rolesLoading || isPending) {
    return (
      <AppLayout title="Messages">
        <div className="py-16 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Messages">
      <div className="max-w-6xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {isTutor
              ? unreadTotal > 0
                ? `${unreadTotal} message${unreadTotal === 1 ? "" : "s"} waiting for a reply.`
                : "Everything's answered."
              : "Ask your tutor anything — attach the spec point, homework or quiz you're stuck on."}
          </p>
          {!isTutor && (
            <button
              onClick={() => setComposing(true)}
              className="btn-premium inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-semibold"
            >
              <MessageSquarePlus className="h-4 w-4" /> Ask a question
            </button>
          )}
        </div>

        {threads.length === 0 ? (
          <div className="premium-card rounded-2xl p-10 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <MessagesSquare className="h-6 w-6" />
            </div>
            <h2 className="font-display text-lg font-semibold">
              {isTutor ? "No questions yet" : "No conversations yet"}
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {isTutor
                ? "When a student asks a question it lands here, with the spec point or homework they were working on attached."
                : "Stuck on something? Ask your tutor — they'll see exactly which part of the spec you mean."}
            </p>
            {!isTutor && (
              <button
                onClick={() => setComposing(true)}
                className="btn-premium mt-5 inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold"
              >
                <MessageSquarePlus className="h-4 w-4" /> Ask a question
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
            <div className="premium-card max-h-[70vh] overflow-y-auto rounded-2xl">
              <ThreadList
                threads={threads}
                selectedId={selectedId}
                onSelect={setSelectedId}
                showCounterpart={isTutor}
              />
            </div>
            <div className="premium-card h-[70vh] overflow-hidden rounded-2xl">
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
