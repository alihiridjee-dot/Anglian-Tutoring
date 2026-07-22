import { useNavigate } from "@tanstack/react-router";
import { CreditCard, Lock } from "lucide-react";

/**
 * Frosted-glass paywall shown over the live dashboard when a student's
 * subscription is not active.
 *
 * Deliberately an OVERLAY, not a redirect: the platform stays rendered behind a
 * backdrop blur so the student can see what they're locked out of, with a single
 * call to action to resubscribe. It sends them to /onboarding/plan — which sits
 * outside the /_authenticated guard, so it stays reachable without access and is
 * the one place that handles both paying now and inviting a parent to pay.
 *
 * Billing routes are exempt upstream (the guard never mounts this there), so a
 * student who merely paused or cancelled can still get back in to resume.
 */
export function PaywallOverlay() {
  const navigate = useNavigate();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/50 backdrop-blur-xl"
    >
      <div className="w-full max-w-md rounded-3xl border border-white/20 bg-card/80 backdrop-blur-md shadow-2xl p-8 text-center ring-1 ring-black/5">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Lock className="h-6 w-6" />
        </div>

        <h1
          id="paywall-title"
          className="font-display text-2xl font-semibold tracking-tight mb-2"
        >
          Please resubscribe
        </h1>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          Your subscription isn't active, so your dashboard is locked. Resubscribe
          to pick up right where you left off — your progress and history are all
          still here.
        </p>

        <button
          type="button"
          onClick={() => navigate({ to: "/onboarding/plan" })}
          className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 text-sm shadow-sm inline-flex items-center justify-center gap-2"
        >
          <CreditCard className="h-4 w-4" /> Resubscribe
        </button>

        <button
          type="button"
          onClick={() => navigate({ to: "/billing" })}
          className="mt-3 text-xs text-muted-foreground hover:text-foreground"
        >
          Manage billing instead
        </button>
      </div>
    </div>
  );
}
