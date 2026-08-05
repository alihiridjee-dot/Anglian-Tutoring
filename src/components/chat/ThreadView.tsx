import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useChatMessages, useMarkThreadRead, useSendMessage } from "@/hooks/data/useChat";
import { generateChatDraft } from "@/lib/chatDraft.functions";
import { contextTarget } from "@/lib/chatDal";
import type { ThreadSummary } from "@/hooks/data/useChat";

interface Props {
  thread: ThreadSummary;
  /** The signed-in user, so messages can be sided without a second lookup. */
  viewerId: string;
  /** Tutors get the AI draft button; students never do. */
  isTutor: boolean;
}

/**
 * One conversation: what was said, and the box to answer in.
 *
 * On the tutor's side there is a "Draft with AI" button. It only ever fills the
 * textarea — the tutor reads, edits and sends. Nothing is auto-sent, and the
 * student is never told a draft was involved, because the message they receive
 * is the one their tutor chose to send. That is the whole point of the product
 * they're paying for; an autoresponder wearing the tutor's name would be a
 * different (and worse) thing.
 */
export function ThreadView({ thread, viewerId, isTutor }: Props) {
  const { data: messages = [], isPending } = useChatMessages(thread.id);
  const send = useSendMessage();
  const markRead = useMarkThreadRead();
  const [body, setBody] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [usedDraft, setUsedDraft] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const markedRef = useRef<string | null>(null);

  // Opening a thread is reading it. Guarded by a ref so the poll refetch doesn't
  // fire a write every twenty seconds.
  useEffect(() => {
    if (thread.unread > 0 && markedRef.current !== thread.id) {
      markedRef.current = thread.id;
      markRead.mutate(thread.id);
    }
    if (markedRef.current !== thread.id) markedRef.current = null;
    // markRead is a stable mutation object; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id, thread.unread]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, thread.id]);

  // Switching threads must not carry a half-written reply into someone else's
  // conversation.
  useEffect(() => {
    setBody("");
    setUsedDraft(false);
  }, [thread.id]);

  const draft = async () => {
    setDrafting(true);
    try {
      const { draft } = await generateChatDraft({ data: { threadId: thread.id } });
      setBody(draft);
      setUsedDraft(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't draft a reply.");
    } finally {
      setDrafting(false);
    }
  };

  const submit = () => {
    if (!body.trim()) return;
    send.mutate(
      { threadId: thread.id, body, aiDrafted: usedDraft },
      {
        onSuccess: () => {
          setBody("");
          setUsedDraft(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const target = contextTarget(thread);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-5 py-4">
        <h2 className="font-display text-base font-semibold leading-tight">
          {thread.subject_line}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>with {thread.counterpartName}</span>
          {thread.context_label && (
            <>
              <span aria-hidden>·</span>
              {target ? (
                <Link {...target} className="inline-flex items-center gap-1 hover:text-foreground">
                  {thread.context_label} <ExternalLink className="h-3 w-3" />
                </Link>
              ) : (
                <span>{thread.context_label}</span>
              )}
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {isPending ? (
          <div className="py-10 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === viewerId;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    mine
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-secondary text-foreground rounded-bl-md"
                  }`}
                >
                  {m.body}
                  <div
                    className={`mt-1 text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                  >
                    {new Date(m.created_at).toLocaleString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-4">
        {isTutor && (
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={draft}
              disabled={drafting || messages.length === 0}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted disabled:opacity-50"
            >
              {drafting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-primary" />
              )}
              Draft with AI
            </button>
            {usedDraft && (
              <span className="text-[11px] text-muted-foreground">
                Draft only — read it and edit before sending.
              </span>
            )}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            placeholder={isTutor ? "Write your reply…" : "Write a message…"}
            className="flex-1 rounded-xl border border-border bg-background p-3 text-sm transition focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!body.trim() || send.isPending}
            aria-label="Send message"
            className="btn-premium h-11 w-11 shrink-0 rounded-xl inline-flex items-center justify-center disabled:opacity-50"
          >
            {send.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
