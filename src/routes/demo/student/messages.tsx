import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ExternalLink, Send } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { ThreadList } from "@/components/chat/ThreadList";
import type { ThreadSummary } from "@/hooks/data/useChat";

// Showcase mount of Messages. The live page reads and writes `chat_threads` and
// `chat_messages` for a signed-in student, so the showcase renders the shared
// `ThreadList` over fixtures and draws the open conversation itself. A message a
// visitor types is added to the page and goes nowhere else.
export const Route = createFileRoute("/demo/student/messages")({
  head: () => ({ meta: [{ title: "Messages | Anglia Educate" }] }),
  component: DemoMessagesPage,
});

const STUDENT = "demo-student";
const TUTOR = "demo-tutor";
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

type DemoMessage = { id: string; from: string; body: string; at: string };
type DemoThread = ThreadSummary & {
  messages: DemoMessage[];
  /** Where the attached context opens inside the showcase. */
  link: {
    to: "/demo/student/homework/$homeworkId" | "/demo/student/mcq/$setId";
    id: string;
  } | null;
};

const thread = (
  t: Pick<ThreadSummary, "id" | "subject" | "subject_line" | "context_label" | "contextKind"> & {
    unread?: number;
    messages: DemoMessage[];
    link: DemoThread["link"];
  },
): DemoThread => {
  const last = t.messages[t.messages.length - 1];
  return {
    student_id: STUDENT,
    tutor_id: TUTOR,
    spec_point_id: null,
    resource_id: null,
    mcq_set_id: null,
    status: "open",
    student_last_read_at: last.at,
    tutor_last_read_at: last.at,
    created_at: t.messages[0].at,
    last_message_at: last.at,
    lastMessage: last.body,
    counterpartName: "Ms Patel (Biology)",
    unread: t.unread ?? 0,
    ...t,
  };
};

const THREADS: DemoThread[] = [
  thread({
    id: "demo-thread-photo",
    subject: "biology",
    subject_line: "Why does the rate plateau?",
    context_label: "Homework · Photosynthesis: Limiting Factors",
    contextKind: "homework",
    unread: 1,
    link: { to: "/demo/student/homework/$homeworkId", id: "demo-hw-photosynthesis" },
    messages: [
      {
        id: "m1",
        from: STUDENT,
        body: "I lost a mark on question 2. I said CO₂ becomes the limiting factor — what was missing?",
        at: ago(20),
      },
      {
        id: "m2",
        from: TUTOR,
        body: "You were nearly there! The mark scheme wants you to say the rate is capped by whichever factor is in shortest supply. Naming CO₂ gets one mark; explaining why the line goes flat gets the other.",
        at: ago(3),
      },
      {
        id: "m3",
        from: TUTOR,
        body: "Try this: “Beyond this point, increasing light has no effect because another factor, such as CO₂ concentration, is now limiting the rate.” We'll practise a few more in this week's live session.",
        at: ago(2.9),
      },
    ],
  }),
  thread({
    id: "demo-thread-osmosis",
    subject: "biology",
    subject_line: "Osmosis quiz — question 3",
    context_label: "Quiz · Transport in Cells",
    contextKind: "mcq_set",
    link: { to: "/demo/student/mcq/$setId", id: "demo-mcq-transport" },
    messages: [
      {
        id: "m4",
        from: STUDENT,
        body: "Why does the potato chip lose mass in salt water? I thought the salt would go in.",
        at: ago(14),
      },
      {
        id: "m5",
        from: TUTOR,
        body: "Good question. The membrane lets water through far more easily than salt. The solution outside is more concentrated, so water moves out of the potato cells by osmosis — that's the mass you lose.",
        at: ago(11),
      },
      { id: "m6", from: STUDENT, body: "Ah that makes sense now, thank you!", at: ago(10) },
    ],
  }),
];

function DemoMessagesPage() {
  const [selectedId, setSelectedId] = useState(THREADS[0].id);
  const [sent, setSent] = useState<Record<string, DemoMessage[]>>({});
  const [body, setBody] = useState("");

  const threads = useMemo(
    () =>
      THREADS.map((t) => {
        const extra = sent[t.id] ?? [];
        const last = extra[extra.length - 1];
        return {
          ...t,
          // Opening a thread reads it, as it does on the live page.
          unread: t.id === selectedId ? 0 : t.unread,
          lastMessage: last?.body ?? t.lastMessage,
          last_message_at: last?.at ?? t.last_message_at,
        };
      }),
    [sent, selectedId],
  );
  const selected = threads.find((t) => t.id === selectedId) ?? threads[0];
  const messages = [...selected.messages, ...(sent[selected.id] ?? [])];

  const submit = () => {
    const text = body.trim();
    if (!text) return;
    const message = {
      id: `local-${Date.now()}`,
      from: STUDENT,
      body: text,
      at: new Date().toISOString(),
    };
    setSent((s) => ({ ...s, [selected.id]: [...(s[selected.id] ?? []), message] }));
    setBody("");
  };

  return (
    <AppLayout title="Messages">
      <div className="max-w-6xl">
        <div className="mb-4">
          <p className="text-sm text-muted-foreground">
            Ask your tutor anything — attach the spec point, homework or quiz you're stuck on.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
          <div
            data-guide="message-list"
            data-tour="messages"
            className="pop-card scroll-slim max-h-[70vh] overflow-y-auto"
          >
            <ThreadList
              threads={threads}
              selectedId={selected.id}
              onSelect={setSelectedId}
              showCounterpart={false}
            />
          </div>

          <div
            data-guide="message-thread"
            className="premium-card flex h-[70vh] min-h-0 flex-col overflow-hidden rounded-2xl"
          >
            <div className="border-b border-border px-5 py-4">
              <h2 className="font-display text-base font-bold leading-tight">
                {selected.subject_line}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>with {selected.counterpartName}</span>
                {selected.context_label && selected.link && (
                  <>
                    <span aria-hidden>·</span>
                    <Link
                      to={selected.link.to}
                      params={
                        selected.link.to === "/demo/student/mcq/$setId"
                          ? { setId: selected.link.id }
                          : { homeworkId: selected.link.id }
                      }
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {selected.context_label} <ExternalLink className="h-3 w-3" />
                    </Link>
                  </>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {messages.map((m) => {
                const mine = m.from === STUDENT;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                        mine
                          ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)] rounded-br-md font-medium"
                          : "surface-soft text-foreground rounded-bl-md"
                      }`}
                    >
                      {m.body}
                      <div
                        className={`mt-1 text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                      >
                        {new Date(m.at).toLocaleString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-border p-4">
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
                  placeholder="Write a message…"
                  className="flex-1 rounded-xl border border-border bg-background p-3 text-sm transition focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={!body.trim()}
                  aria-label="Send message"
                  className="btn-premium h-11 w-11 shrink-0 rounded-xl inline-flex items-center justify-center disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
