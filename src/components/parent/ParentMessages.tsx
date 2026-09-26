import { useMemo, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { ErrorNote, SectionHeading, Spinner } from "@/components/Shared";
import { useRoles } from "@/hooks/useRole";
import { useChatThreads, type ThreadSummary } from "@/hooks/data/useChat";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const aboutChild = useMemo(
    () => threads.filter((t) => t.about_student_id === childId),
    [threads, childId],
  );
  const selected = aboutChild.find((t) => t.id === selectedId) ?? aboutChild[0] ?? null;

  return (
    <section data-tour="parent-messages" className="premium-card p-6">
      <SectionHeading title="Messages">
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="btn-solid inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold"
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
            <div className="pop-card pop-card-flat scroll-slim max-h-[28rem] overflow-y-auto">
              <ThreadList
                threads={aboutChild}
                selectedId={selected?.id ?? null}
                onSelect={setSelectedId}
                showCounterpart
              />
            </div>
            <div className="pop-card pop-card-flat h-[28rem] overflow-hidden">
              {selected && userId && (
                <ThreadView thread={selected} viewerId={userId} isTutor={false} />
              )}
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
          }}
        />
      )}
    </section>
  );
}
