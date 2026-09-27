import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Loader2, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { requestTrialCode, readTrialCode } from "@/lib/billing/trialCode";
import { TRIAL_DAYS } from "@/components/billing/TrialCodeField";

const DISMISSED_KEY = "trial-offer-dismissed-at";
/** How long a closed pop-up stays closed. */
const QUIET_MS = 7 * 24 * 60 * 60_000;
/** How long a visitor reads the page before it appears. */
const DELAY_MS = 6_000;

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY));
    return !!at && Date.now() - at < QUIET_MS;
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    /* Storage unavailable: it may show again next visit. */
  }
}

/**
 * The landing page's free-trial offer. A visitor leaves an email address and
 * the trial-code function sends them a code of their own, good for one
 * 14-day trial. Appears once, a few seconds in; closed, it stays away a week.
 * Someone who already holds a code is never shown it.
 */
export function TrialOfferPopup() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  // Honeypot: never shown to a person, so a real request leaves it empty.
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    if (recentlyDismissed() || readTrialCode()) return;
    const t = setTimeout(() => setOpen(true), DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      markDismissed();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => {
    markDismissed();
    setOpen(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      await requestTrialCode(email.trim(), website);
      markDismissed();
      setSentTo(email.trim());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "We couldn't send the email just now.");
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-offer-title"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="pop-card pop-card-hero rise-in tint-primary relative w-full max-w-md p-7 sm:p-8">
        <button
          type="button"
          onClick={close}
          className="absolute top-4 right-4 w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {sentTo ? (
          <div className="text-center">
            <div className="icon-tile mx-auto w-12 h-12">
              <Mail className="w-5 h-5" />
            </div>
            <h2 id="trial-offer-title" className="mt-4 text-2xl font-extrabold tracking-tight">
              Check your inbox
            </h2>
            <p className="mt-2 text-sm">
              Your code is on its way to <span className="font-semibold">{sentTo}</span>. The link
              in the email fills it in for you.
            </p>
            <Link
              to="/auth"
              search={{ mode: "signup" }}
              onClick={close}
              className="btn-premium mt-6 w-full h-11 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2"
            >
              Create your account <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <>
            <span className="sticker">{TRIAL_DAYS} days free</span>
            <h2 id="trial-offer-title" className="mt-4 text-2xl font-extrabold tracking-tight">
              Try Anglia Educate <span className="marker">free for two weeks</span>
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
              Live lessons, marked homework and weekly quizzes. We'll email you a code of your own
              to use when you sign up.
            </p>

            <form onSubmit={submit} className="mt-5 space-y-3">
              {/* Honeypot — hidden from people, catnip for bots. Not tab-reachable. */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="hidden"
              />
              <label htmlFor="trial-offer-email" className="eyebrow text-[10px]">
                Email
              </label>
              <input
                id="trial-offer-email"
                required
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="premium-input w-full h-11 rounded-xl px-4 text-sm"
              />
              <button
                disabled={sending}
                className="btn-premium w-full h-11 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2"
              >
                {sending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Mail className="w-4 h-4" />
                )}
                {sending ? "Sending…" : "Email my code"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
