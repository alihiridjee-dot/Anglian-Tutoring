import { useMemo, useState } from "react";
import { ArrowLeft, MessageSquarePlus } from "lucide-react";
import { ErrorNote, SectionHeading, Spinner } from "@/components/Shared";
import { useRoles } from "@/hooks/useRole";
import { useChatThreads, usePinnedThread, type ThreadSummary } from "@/hooks/data/useChat";
import { ThreadList } from "@/components/chat/ThreadList";
import { ThreadView } from "@/components/chat/ThreadView";
import { NewThreadDialog } from "@/components/chat/NewThreadDialog";

const EMPTY_THREADS: ThreadSummary[] = [];

/**
 * A parent's conversations with the tutors about one child.
 *
 * The same list and thread the Messages page uses — a parent is simply the
 * thread's member, as a student is on theirs — narrowed to the child being
 * viewed, so switching child switches conversation. A parent only ever sees
 * threads they opened: never their child's own questions.
 */
export function ParentMessages({ childId, childName }: { childId: string; childName: string }) {
  const { userId } = useRoles();
  const { data: threads = EMPTY_THREADS, isPending, error, refetch } = useChatThreads();
  const [composing, setComposing] = useState(false);
  // On a phone the list and the thread take turns, as on the Messages page:
  // picking a row opens the thread, and the back arrow returns to the list.
  const [threadOpen, setThreadOpen] = useState(false);

  const aboutChild = useMemo(
    () => threads.filter((t) => t.about_student_id === childId),
    [threads, childId],
  );
  // Pinned, not "whichever is first": the poll re-sorts the list when a tutor
  // replies elsewhere, and following it moved a parent's half-written reply
  // into another conversation.
  const [selectedId, setSelectedId] = usePinnedThread(aboutChild);
  const selected = aboutChild.find((t) => t.id === selectedId) ?? null;

  return (
    <section data-tour="parent-messages" className="premium-card p-4 sm:p-6">
      <SectionHeading title="Messages">
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="btn-solid inline-flex h-11 items-center sm:pointer-fine:h-9 gap-1.5 rounded-lg px-3.5 text-sm font-semibold"
        >
          <MessageSquarePlus className="size-4" aria-hidden /> Message a tutor
        </button>
      </SectionHeading>

      {error && aboutChild.length === 0 ? (
        <div className="mt-5">
          <ErrorNote error={error} onRetry={() => void refetch()} />
        </div>
      ) : isPending ? (
        <Spinner label="Loading messages" className="py-10" />
      ) : (
        aboutChild.length > 0 && (
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
            <div
              className={`pop-card pop-card-flat scroll-slim max-h-[28rem] overflow-y-auto ${threadOpen ? "max-lg:hidden" : ""}`}
            >
              <ThreadList
                threads={aboutChild}
                selectedId={selected?.id ?? null}
                onSelect={(id) => {
                  setSelectedId(id);
                  setThreadOpen(true);
                }}
                showCounterpart
              />
            </div>
            {/* A fixed 448px box is taller than a phone turned sideways, so
                open there it takes the whole screen like the student's does. */}
            <div
              className={`pop-card pop-card-flat flex h-[28rem] min-h-0 flex-col overflow-hidden ${threadOpen ? "thread-sideways" : "max-lg:hidden"}`}
            >
              <button
                type="button"
                onClick={() => setThreadOpen(false)}
                className="border-border text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-2 border-b px-4 text-sm font-semibold lg:hidden short:hidden"
              >
                <ArrowLeft className="size-4" aria-hidden /> All conversations
              </button>
              <div className="min-h-0 flex-1">
                {selected && userId && (
                  <ThreadView
                    thread={selected}
                    viewerId={userId}
                    isTutor={false}
                    onBack={() => setThreadOpen(false)}
                  />
                )}
              </div>
            </div>
          </div>
        )
      )}

      {composing && (
        <NewThreadDialog
          about={{ studentId: childId, name: childName }}
          onClose={() => setComposing(false)}
          onCreated={(id) => {
            setComposing(false);
            setSelectedId(id);
            setThreadOpen(true);
          }}
        />
      )}
    </section>
  );
}
