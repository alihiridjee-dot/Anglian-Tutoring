import { useState } from "react";
import { BookMarked, ChevronRight, ClipboardList, ListChecks, MessageSquare } from "lucide-react";
import type { ChatContextKind } from "@/lib/chatDal";
import type { ThreadSummary } from "@/hooks/data/useChat";

const CONTEXT_ICON: Record<ChatContextKind, typeof MessageSquare> = {
  spec_point: BookMarked,
  homework: ClipboardList,
  mcq_set: ListChecks,
  general: MessageSquare,
};

/** Short, human relative time — "2h", "3d". Long enough for an inbox row. */
function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * How long a conversation stays in the main list once it goes quiet.
 *
 * A day is about how long a question stays live: past that the answer has
 * landed and been read, and the row is only in the way of the next one. It is
 * a display rule and nothing more — the thread is still here, still searchable
 * by opening the group, and is not deleted until the 30-day sweep.
 */
const DORMANT_AFTER_MS = 24 * 60 * 60 * 1000;

interface Props {
  threads: ThreadSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Tutors need to know whose question it is; a student already knows. */
  showCounterpart: boolean;
}

/**
 * The conversation list, shared by both personas.
 *
 * Identical for a student and a tutor apart from whose name it shows, because
 * the underlying question — "which of these needs me next?" — is the same. Rows
 * lead with the unread state and the context, since those are what decide it.
 *
 * Threads that have been quiet for a day fold away into a collapsed group, so a
 * tutor's inbox reads as "what needs me now" rather than as an archive. Two
 * things are never folded away: anything unread, however old — a message you
 * have not read is exactly what a list is for — and the thread you have open.
 */
export function ThreadList({ threads, selectedId, onSelect, showCounterpart }: Props) {
  const [showDormant, setShowDormant] = useState(false);

  const cutoff = Date.now() - DORMANT_AFTER_MS;
  const isDormant = (t: ThreadSummary) =>
    t.unread === 0 && t.id !== selectedId && new Date(t.last_message_at).getTime() < cutoff;

  const live = threads.filter((t) => !isDormant(t));
  const dormant = threads.filter(isDormant);

  if (threads.length === 0) {
    return (
      <p className="text-muted-foreground px-4 py-10 text-center text-sm">
        No conversations yet — start one and it&apos;ll show up here.
      </p>
    );
  }

  // Collapsing everything would leave the pane looking empty, which reads as a
  // bug rather than as tidiness. With nothing live, the older ones are the list.
  const collapsed = live.length > 0 && !showDormant;

  return (
    <>
      {/* Expanded, the original list is what renders: it is already sorted by
          recency, and re-joining the two groups would push an old unread thread
          above newer ones it should sit below. */}
      <ThreadRows
        threads={collapsed ? live : threads}
        selectedId={selectedId}
        onSelect={onSelect}
        showCounterpart={showCounterpart}
      />
      {dormant.length > 0 && live.length > 0 && (
        <button
          type="button"
          onClick={() => setShowDormant((v) => !v)}
          className="flex w-full items-center gap-1.5 border-t border-border px-4 py-2.5 text-left text-xs font-medium text-muted-foreground transition hover:bg-muted/40"
          aria-expanded={showDormant}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${showDormant ? "rotate-90" : ""}`}
          />
          {showDormant ? "Hide" : "Show"} {dormant.length} older conversation
          {dormant.length === 1 ? "" : "s"}
        </button>
      )}
    </>
  );
}

function ThreadRows({ threads, selectedId, onSelect, showCounterpart }: Props) {
  return (
    <ul className="divide-y divide-border">
      {threads.map((t) => {
        const Icon = CONTEXT_ICON[t.contextKind];
        const active = t.id === selectedId;
        return (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onSelect(t.id)}
              className={`block w-full px-4 py-3 text-left transition ${
                active ? "bg-primary/[0.07]" : "hover:bg-muted/40"
              }`}
            >
              <div className="flex items-start gap-2">
                {t.unread > 0 && (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`truncate text-sm ${t.unread > 0 ? "font-bold" : "font-medium"}`}
                    >
                      {t.subject_line}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      {ago(t.last_message_at)}
                    </span>
                  </div>
                  {showCounterpart && (
                    <div className="mt-0.5 text-xs font-medium text-muted-foreground truncate">
                      {t.counterpartName}
                    </div>
                  )}
                  {t.context_label && (
                    <div className="mt-1 inline-flex max-w-full items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      <Icon className="h-3 w-3 shrink-0" />
                      <span className="truncate">{t.context_label}</span>
                    </div>
                  )}
                  {t.lastMessage && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">{t.lastMessage}</p>
                  )}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
