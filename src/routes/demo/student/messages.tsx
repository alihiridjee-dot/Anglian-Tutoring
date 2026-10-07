import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Send } from "lucide-react";
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
/**
 * A message sent `daysAgo` days ago at a set time of day on the viewer's
 * clock — after school or in the evening, as a real conversation would be —
 * rather than a fixed number of hours before whenever the page was opened.
 */
const at = (daysAgo: number, hour: number, minute: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

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
    about_student_id: null,
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
    // The same tutor who writes "Ali's take" on the dashboard and planner.
    counterpartName: "Ali (Tutor)",
    unread: t.unread ?? 0,
    ...t,
  };
};

const THREADS: DemoThread[] = [
  thread({
    id: "demo-thread-photo",
    subject: "biology",
    subject_line: "Why does the rate plateau?",
    context_label: "Task · Photosynthesis: Limiting Factors",
    contextKind: "homework",
    unread: 1,
    link: { to: "/demo/student/homework/$homeworkId", id: "demo-hw-photosynthesis" },
    messages: [
      {
        id: "m1",
        from: STUDENT,
        body: "I lost a mark on question 2. I said CO₂ becomes the limiting factor — what was missing?",
        at: at(2, 18, 40),
      },
      {
        id: "m2",
        from: TUTOR,
        body: "You were nearly there! The mark scheme wants you to say the rate is capped by whichever factor is in shortest supply. Naming CO₂ gets one mark; explaining why the line goes flat gets the other.",
        at: at(1, 16, 20),
      },
      {
        id: "m3",
        from: TUTOR,
        body: "Try this: “Beyond this point, increasing light has no effect because another factor, such as CO₂ concentration, is now limiting the rate.” We'll practise a few more in the next live lesson.",
        at: at(1, 16, 22),
      },
    ],
  }),
  thread({
    id: "demo-thread-osmosis",
    subject: "biology",
    subject_line: "Osmosis task — question 2",
    context_label: "Task · EDEX 1.15 Active, Passive & Osmotic Transport",
    contextKind: "homework",
    link: { to: "/demo/student/homework/$homeworkId", id: "demo-hw-osmosis" },
    messages: [
      {
        id: "m4",
        from: STUDENT,
        body: "I'm on question 2 of the osmosis task. Does the potato gain mass in pure water? I thought water always moves out of cells.",
        at: at(3, 17, 50),
      },
      {
        id: "m5",
        from: TUTOR,
        body: "Good question — it depends on what's outside. Pure water is more dilute than the solution inside the potato cells, so water moves into them by osmosis. The cells swell and become turgid, and the potato gains mass. In a strong salt solution it's the other way round, and the potato loses mass.",
        at: at(3, 19, 15),
      },
      { id: "m6", from: STUDENT, body: "Ah that makes sense now, thank you!", at: at(3, 19, 32) },
    ],
  }),
];

function DemoMessagesPage() {
  const [selectedId, setSelectedId] = useState(THREADS[0].id);
  const [sent, setSent] = useState<Record<string, DemoMessage[]>>({});
  const [body, setBody] = useState("");
  // Phones show the list or the thread, not both; see the live page.
  const [threadOpen, setThreadOpen] = useState(false);

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
            Ask your tutor anything — attach the spec point, task or quiz you're stuck on.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
          <div
            data-guide="message-list"
            data-tour="messages"
            className={`pop-card scroll-slim max-h-[70vh] overflow-y-auto ${threadOpen ? "max-lg:hidden" : ""}`}
          >
            <ThreadList
              threads={threads}
              selectedId={selected.id}
              onSelect={(id) => {
                setSelectedId(id);
                setThreadOpen(true);
              }}
              showCounterpart={false}
            />
          </div>

          <div
            data-guide="message-thread"
            className={`premium-card flex h-[70vh] min-h-0 flex-col overflow-hidden rounded-2xl ${threadOpen ? "" : "max-lg:hidden"}`}
          >
            <button
              type="button"
              onClick={() => setThreadOpen(false)}
              className="inline-flex min-h-11 items-center gap-2 border-b border-border px-4 text-sm font-semibold text-muted-foreground hover:text-foreground lg:hidden"
            >
              <ArrowLeft className="size-4" aria-hidden /> All conversations
            </button>
            <div className="border-b border-border px-4 py-4 sm:px-5">
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

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
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
                  aria-label="Your message"
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
