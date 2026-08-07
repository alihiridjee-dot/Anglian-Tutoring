import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { sendWhatsAppLead } from "@/lib/whatsappLead.functions";
import { whatsappLink } from "@/lib/whatsapp";

/**
 * The showcase's message box — the demo's counterpart to a student's tutor chat.
 *
 * Everywhere else in /demo/* the student is talking to a fixture. Here they are
 * not, and the component says so plainly rather than staging a fake reply from
 * "your tutor": the conversation is delivered to the team's real WhatsApp, and a
 * visitor typing a question about their child deserves to know where it lands
 * before they type it, not after. That honesty is also what makes the box
 * useful — this is the demo's one live surface, and it is a sales channel.
 *
 * The shape deliberately mirrors `chat/ThreadView`: same bubbles, same compose
 * row, same send affordance. Someone poking at the demo is being shown what
 * messaging their tutor will feel like once they've signed up, so the two must
 * look like the same product. Only the accent colour differs, because green is
 * the one honest signal that this particular message leaves the platform.
 *
 * Three short turns collect what the sales team needs to answer: the question,
 * a name, an email. Asking for them one at a time — rather than fronting a
 * four-field form — is why anyone finishes.
 */

type Author = "them" | "me";
interface Bubble {
  id: number;
  from: Author;
  body: string;
}

/** Which answer the next message will be read as. */
type Step = "message" | "name" | "email" | "sending" | "done";

const PROMPTS: Record<Exclude<Step, "sending" | "done">, string> = {
  message:
    "Hi! 👋 You're looking at a demo account — but this chat is real, and it reaches us on WhatsApp. What would you like to know about tutoring for your child?",
  name: "Thanks — that's a good question. Who am I speaking to?",
  email:
    "Lovely to meet you. What's the best email to reply on, in case WhatsApp doesn't reach you?",
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** How long the reply "takes to type". Long enough to read as a person, short enough not to stall. */
const TYPING_MS = 650;

export function DemoSalesChat() {
  const [bubbles, setBubbles] = useState<Bubble[]>([
    { id: 0, from: "them", body: PROMPTS.message },
  ]);
  const [step, setStep] = useState<Step>("message");
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [trap, setTrap] = useState("");
  const [answers, setAnswers] = useState({ message: "", name: "", email: "" });

  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // A pending "typing…" timer must not fire into an unmounted component — the
  // student can navigate away from the dashboard mid-conversation.
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [bubbles.length, typing]);

  const push = (from: Author, body: string) =>
    setBubbles((b) => [...b, { id: nextId.current++, from, body }]);

  /** Say something back after a beat, so the exchange reads as a conversation. */
  const reply = (body: string, then?: () => void) => {
    setTyping(true);
    const t = setTimeout(() => {
      setTyping(false);
      push("them", body);
      then?.();
    }, TYPING_MS);
    timers.current.push(t);
  };

  const submit = async (collected: typeof answers) => {
    setStep("sending");
    try {
      const { delivered } = await sendWhatsAppLead({
        data: { ...collected, website: trap || null },
      });
      setStep("done");
      reply(
        delivered
          ? "Sent — that's landed on our WhatsApp and one of us will come back to you shortly. If you'd rather carry on there now, the button below opens the thread with your question already in it."
          : "Got it — your enquiry is with the team and we'll be in touch by email shortly. If you'd like an answer faster, the button below opens WhatsApp with your question ready to send.",
      );
    } catch (err) {
      setStep("email");
      toast.error(err instanceof Error ? err.message : "Couldn't send that just now.");
    }
  };

  const send = () => {
    const value = draft.trim();
    if (!value || typing || step === "sending" || step === "done") return;

    if (step === "email" && !EMAIL_RE.test(value)) {
      toast.error("That email address doesn't look right.");
      return;
    }

    push("me", value);
    setDraft("");

    if (step === "message") {
      setAnswers((a) => ({ ...a, message: value }));
      reply(PROMPTS.name, () => setStep("name"));
    } else if (step === "name") {
      setAnswers((a) => ({ ...a, name: value }));
      reply(PROMPTS.email, () => setStep("email"));
    } else if (step === "email") {
      const collected = { ...answers, email: value };
      setAnswers(collected);
      void submit(collected);
    }
  };

  const composerDisabled = typing || step === "sending" || step === "done";
  const placeholder =
    step === "name"
      ? "Your name…"
      : step === "email"
        ? "you@example.com"
        : step === "message"
          ? "Ask us anything…"
          : "Thanks — we'll be in touch.";

  return (
    <section className="premium-card mt-6 overflow-hidden rounded-2xl">
      <header className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-3 sm:px-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#1ebd5b]/30 bg-[#25D366]/15">
          <WhatsAppGlyph className="h-4.5 w-4.5 text-[#128C7E]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-bold leading-tight text-foreground">
            Talk to the team
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            Goes straight to our WhatsApp · usually answered the same day
          </p>
        </div>
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-[#25D366]" /> Live
        </span>
      </header>

      <div className="max-h-[22rem] min-h-[13rem] space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
        {bubbles.map((b) => (
          <div key={b.id} className={`flex ${b.from === "me" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                b.from === "me"
                  ? "rounded-br-md bg-primary text-primary-foreground"
                  : "rounded-bl-md bg-secondary text-foreground"
              }`}
            >
              {b.body}
            </div>
          </div>
        ))}

        {typing && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-secondary px-4 py-3">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </div>
          </div>
        )}

        {step === "done" && !typing && (
          <a
            href={whatsappLink(`Hi Anglia Educate — I'm ${answers.name}. ${answers.message}`)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#1ebd5b]"
          >
            <WhatsAppGlyph className="h-4 w-4" /> Continue on WhatsApp
          </a>
        )}

        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-4">
        {/* Honeypot: never shown, never announced, never focusable. */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          value={trap}
          onChange={(e) => setTrap(e.target.value)}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
        />

        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={step === "message" ? 2 : 1}
            disabled={composerDisabled}
            placeholder={placeholder}
            aria-label={placeholder}
            className="flex-1 resize-none rounded-xl border border-border bg-background p-3 text-sm transition focus:border-[#25D366] focus:outline-none focus:ring-4 focus:ring-[#25D366]/15 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={send}
            disabled={composerDisabled || !draft.trim()}
            aria-label="Send message"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#25D366] text-white transition hover:bg-[#1ebd5b] disabled:opacity-50"
          >
            {step === "sending" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : step === "done" ? (
              <Check className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>

        <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-primary/70" />
          Your details go to Anglia Educate so we can reply — nothing else, and never passed on.
        </p>
      </div>
    </section>
  );
}

/** The WhatsApp mark. lucide has no brand icons, and a generic bubble would misrepresent where this goes. */
function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.48-.5-.67-.5h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.01-1.04 2.47s1.06 2.86 1.21 3.06c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z" />
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91A9.85 9.85 0 0 0 19.06 4.9 9.85 9.85 0 0 0 12.04 2zm0 18.13h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.17 8.17 0 0 1-1.25-4.36c0-4.54 3.7-8.23 8.24-8.23a8.18 8.18 0 0 1 5.82 2.42 8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.24-8.25 8.24z" />
    </svg>
  );
}
