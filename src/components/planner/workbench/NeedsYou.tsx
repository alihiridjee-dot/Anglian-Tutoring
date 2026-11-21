import { useState, type ReactNode } from "react";
import {
  CalendarX,
  ClipboardCheck,
  MessageCircle,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { QUIET, SOLID, TINT_TEXT } from "./figures";
import { Panel } from "./PlanGrid";

/** What kind of thing is waiting, which decides its colour, icon and name. */
export type NeedKind = "checkin" | "message" | "parent" | "missed" | "plan";
const KINDS: Record<NeedKind, { name: string; tint: string; icon: LucideIcon }> = {
  checkin: { name: "Check-in", tint: "tint-accent", icon: ClipboardCheck },
  message: { name: "Message", tint: "tint-primary", icon: MessageCircle },
  parent: { name: "Message from a parent", tint: "tint-primary", icon: MessageCircle },
  // The same amber as the grid's Catch-up lane: it is the same work.
  missed: { name: "Missed work", tint: "tint-amber", icon: CalendarX },
  plan: { name: "The plan", tint: "tint-rose", icon: TriangleAlert },
};

/** One thing waiting on the tutor. */
export interface Need {
  id: string;
  kind: NeedKind;
  /** What the item is called, when its kind's own name would only repeat the panel's. */
  name?: string;
  /** When, in words: "Wed 18 Nov", "Since 2 Nov". */
  when: string;
  text: ReactNode;
  /** It can be answered in place. */
  canReply?: boolean;
  /** One plain action that isn't a reply: "Show in the plan". */
  action?: { label: string; run: () => void };
}

/**
 * One list of things about a student, under a title that says what they are.
 * The workbench draws up to three: what the student has sent and is waiting on
 * an answer to ("To answer"), what they have missed ("Missed work"), and what
 * is wrong with the plan itself ("About the plan"). They were one panel called
 * "Needs you", which Ali could not read: missed work is not waiting on anyone.
 *
 * Each item is marked by its kind (a stripe, an icon and a name, in one
 * colour), with its date opposite. A check-in or a message has its reply box
 * under it, or can be cleared with "No reply needed". Not drawn when empty.
 */
export function NeedsYou({
  title,
  id,
  needs,
  busy,
  onReply,
  onSettle,
}: {
  /** What these items are, in the tutor's words: "To answer", "Missed work". */
  title: string;
  id?: string;
  needs: Need[];
  /** The item being saved, by id. */
  busy: string | null;
  /** Resolves once the reply is saved; a refusal leaves the words in the box. */
  onReply: (need: Need, words: string) => Promise<boolean>;
  onSettle: (need: Need) => void;
}) {
  const [replying, setReplying] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  if (needs.length === 0) return null;
  return (
    <Panel id={id} title={title}>
      <ul className="space-y-4 p-3 text-sm">
        {needs.map((need) => {
          const { tint, icon: Icon } = KINDS[need.kind];
          const name = need.name ?? KINDS[need.kind].name;
          const mine = busy === need.id;
          return (
            <li key={need.id} className={cn(tint, "border-l-4 border-[var(--tint)] pl-3")}>
              <div className="flex items-center justify-between gap-2">
                <b className={cn("inline-flex items-center gap-1.5", TINT_TEXT)}>
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {name}
                </b>
                <span className="whitespace-nowrap">{need.when}</span>
              </div>
              <div className="break-words">{need.text}</div>
              {need.canReply && replying === need.id ? (
                <div className="mt-1.5 space-y-1.5">
                  <textarea
                    autoFocus
                    rows={3}
                    aria-label={`Reply to this ${name.toLowerCase()}`}
                    className="premium-input w-full resize-none rounded-lg! px-2 py-1.5"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      disabled={!draft.trim() || busy !== null}
                      className={SOLID}
                      onClick={async () => {
                        if (await onReply(need, draft)) {
                          setReplying(null);
                          setDraft("");
                        }
                      }}
                    >
                      {mine ? "Sending" : "Send"}
                    </button>
                    <button
                      type="button"
                      className={QUIET}
                      disabled={mine}
                      onClick={() => setReplying(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                (need.canReply || need.action) && (
                  <div className="-ml-2 flex flex-wrap">
                    {need.canReply && (
                      <>
                        <button
                          type="button"
                          className={QUIET}
                          disabled={busy !== null}
                          onClick={() => {
                            setReplying(need.id);
                            setDraft("");
                          }}
                        >
                          Reply
                        </button>
                        <button
                          type="button"
                          className={QUIET}
                          disabled={busy !== null}
                          onClick={() => onSettle(need)}
                        >
                          No reply needed
                        </button>
                      </>
                    )}
                    {need.action && (
                      <button type="button" className={QUIET} onClick={need.action.run}>
                        {need.action.label}
                      </button>
                    )}
                  </div>
                )
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
