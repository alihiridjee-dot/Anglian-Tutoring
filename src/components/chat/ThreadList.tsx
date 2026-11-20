import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ThreadSummary } from "@/hooks/data/useChat";
import { SciText } from "@/components/Shared";
import { CONTEXT_EMOJI } from "@/lib/chat/chatContext";
import { subjectTint } from "@/lib/curriculum/subjectTheme";
import { cn } from "@/lib/utils";

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
          className="inbox-more"
          aria-expanded={showDormant}
        >
          <ChevronRight
            className={`size-4 shrink-0 transition-transform ${showDormant ? "rotate-90" : ""}`}
          />
          {showDormant ? "Hide" : "Show"} {dormant.length} older conversation
          {dormant.length === 1 ? "" : "s"}
        </button>
      )}
    </>
  );
}

/**
 * The conversations as bare rows, as on a spec point's page: no dividers and no
 * grey. Each row leads with a round dot in its subject's colour holding what
 * the question is about (❓ 🔬 ✏️ 🎯), with a count of unread replies on it.
 * The title is bold, the attachment is one line in the subject's colour when
 * it says more than the title, and the last message is one dark line. The open
 * conversation is washed in its colour, and pointing at a row makes its dot hop.
 */
function ThreadRows({ threads, selectedId, onSelect, showCounterpart }: Props) {
  return (
    <ul className="space-y-1 p-2">
      {threads.map((t) => {
        const active = t.id === selectedId;
        // A subject line seeded from the attachment says the same thing twice.
        const context =
          t.context_label &&
          t.context_label.trim().toLowerCase() !== t.subject_line.trim().toLowerCase()
            ? t.context_label
            : null;
        return (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onSelect(t.id)}
              aria-current={active ? "true" : undefined}
              className={cn("inbox-row", subjectTint(t.subject ?? ""))}
            >
              <span className="inbox-row-dot">
                <span aria-hidden>{CONTEXT_EMOJI[t.contextKind]}</span>
                {t.unread > 0 && (
                  <span className="inbox-row-count">
                    {t.unread}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-display truncate text-lg leading-snug font-bold">
                    {t.subject_line}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {ago(t.last_message_at)}
                  </span>
                </span>
                {showCounterpart && (
                  <span className="block truncate text-sm font-semibold">{t.counterpartName}</span>
                )}
                {context && <span className="inbox-row-context">{context}</span>}
                {t.lastMessage && (
                  <span className="mt-0.5 block truncate text-sm">
                    <SciText text={t.lastMessage} oneLine />
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
