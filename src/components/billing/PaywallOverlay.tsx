import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, CreditCard, Lock, LockOpen, MessageSquare, RotateCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Spinner } from "@/components/Shared";
import { useOwnPlanState } from "@/hooks/data/useBilling";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

/**
 * Frosted-glass paywall shown over the live dashboard when a student's
 * subscription is not active.
 *
 * Deliberately an OVERLAY, not a redirect: the platform stays rendered behind a
 * backdrop blur so the student can see what they're locked out of, with a single
 * call to action.
 *
 * Drawn in the house style ("playful minimalism", README): no card, the title
 * large on the frost with the highlighter stroke under it, one dark line, one
 * big button, and the lock above springs open as the button is reached.
 *
 * That call to action is NOT always "subscribe". A paused plan — and a plan
 * running to a period end — is a live Stripe subscription that Resume brings
 * straight back for nothing, so this asks {@link useOwnPlanState} first and
 * sends those students to Billing to resume. Telling someone who deliberately
 * paused to "resubscribe" is how a family ends up paying twice: the webhook
 * upserts subscriptions on student_id, so a second plan overwrites the row while
 * the first bills on unseen. The edge function refuses that purchase outright;
 * this makes sure we never ask for it.
 *
 * Billing routes are exempt upstream (the guard never mounts this there), so a
 * student who paused or cancelled can always get back in to resume. Messages
 * is exempt too, and linked from here, so they can always ask a tutor.
 */
export function PaywallOverlay() {
  const navigate = useNavigate();
  const { resumable, paymentOverdue, neverSubscribed, isPending, error, refetch } =
    useOwnPlanState();
  // The lock opens while the main button is pointed at or focused.
  const [reaching, setReaching] = useState(false);
  // The locked page underneath must not scroll under a thumb.
  useBodyScrollLock(true);

  const reach = {
    onPointerEnter: () => setReaching(true),
    onPointerLeave: () => setReaching(false),
    onFocus: () => setReaching(true),
    onBlur: () => setReaching(false),
  };
  const toBilling = () => navigate({ to: "/billing" });
  // A lapsed plan (a free trial that ended included) gets Billing beside
  // Messages; so does the error, where Billing shows the plan as it really is.
  const lapsed = !isPending && !error && !resumable && !paymentOverdue && !neverSubscribed;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
      // Taller than a phone turned sideways, so the overlay scrolls; `m-auto`
      // still centres the words wherever they fit.
      className="fixed inset-0 z-50 flex overflow-y-auto overscroll-contain p-4 bg-background/60 backdrop-blur-xl"
    >
      <div data-reaching={reaching} className="pop-in m-auto w-full max-w-lg py-6 text-center">
        <span className="paywall-dot">{reaching ? <LockOpen /> : <Lock />}</span>

        {isPending ? (
          <Spinner label="Checking your plan" className="pt-8 pb-4" />
        ) : error ? (
          // "Couldn't read your plan" must not fall through to "Please
          // resubscribe": that is the wrong instruction for anyone who only
          // paused, and it is the one that leads to paying twice. Billing can
          // always be opened, and it shows the plan as it really is.
          <>
            <PaywallTitle>We couldn&apos;t check your plan</PaywallTitle>
            <button
              type="button"
              {...reach}
              onClick={() => void refetch()}
              className="btn-solid paywall-btn mt-7"
            >
              <RotateCw className="size-5" /> Try again
            </button>
          </>
        ) : resumable ? (
          <>
            <PaywallTitle>Your plan is on hold</PaywallTitle>
            <PaywallLine>
              Nothing has been lost and there's nothing to buy again — resume from Billing and your
              dashboard, progress and history come straight back.
            </PaywallLine>
            <PaywallButton reach={reach} onClick={toBilling}>
              Resume my plan
            </PaywallButton>
          </>
        ) : paymentOverdue ? (
          // A failed card is not a lapsed plan: the subscription is still there
          // and Stripe retries once the card is updated. The shop would only be
          // refused, so send them to the portal button on Billing.
          <>
            <PaywallTitle>Your last payment didn&apos;t go through</PaywallTitle>
            <PaywallLine>
              Your plan is still here — the card just needs updating. Once it&apos;s updated in
              Billing, your dashboard, progress and history come straight back.
            </PaywallLine>
            <PaywallButton reach={reach} onClick={toBilling}>
              Update the card
            </PaywallButton>
          </>
        ) : neverSubscribed ? (
          // A new student who left the plan step: nothing to "resubscribe" to.
          <>
            <PaywallTitle>Choose a plan to start</PaywallTitle>
            <PaywallButton reach={reach} onClick={() => navigate({ to: "/onboarding/plan" })}>
              Choose a plan
            </PaywallButton>
          </>
        ) : (
          <>
            <PaywallTitle>Please resubscribe</PaywallTitle>
            <PaywallLine>Your progress and history are all still here</PaywallLine>
            <PaywallButton reach={reach} onClick={() => navigate({ to: "/onboarding/plan" })}>
              Resubscribe
            </PaywallButton>
          </>
        )}

        {/* Messages stays open whatever the plan's state (the guard exempts
            it), so a family can always ask a tutor what happened. */}
        <div className="mt-3 flex flex-wrap justify-center gap-1">
          {(error || lapsed) && (
            <PaywallLink icon={CreditCard} onClick={toBilling}>
              {error ? "Open Billing" : "Manage billing"}
            </PaywallLink>
          )}
          <PaywallLink icon={MessageSquare} onClick={() => navigate({ to: "/messages" })}>
            Message your tutor
          </PaywallLink>
        </div>
      </div>
    </div>
  );
}

/** The title on the frost, with the highlighter stroke drawn under it. */
function PaywallTitle({ children }: { children: ReactNode }) {
  return (
    <>
      <h1 id="paywall-title" className="paywall-title mt-6">
        {children}
      </h1>
      <svg
        aria-hidden
        className="point-squiggle mx-auto"
        viewBox="0 0 100 12"
        preserveAspectRatio="none"
      >
        <path d="M2 8 Q 18 1 34 7 T 66 6 T 98 5" vectorEffect="non-scaling-stroke" />
      </svg>
    </>
  );
}

/** The one line under the title, in normal dark text. */
function PaywallLine({ children }: { children: ReactNode }) {
  return <p className="mx-auto mt-4 max-w-md text-lg font-medium">{children}</p>;
}

/** The one big button. Pointing at it opens the lock above. */
function PaywallButton({
  reach,
  onClick,
  children,
}: {
  reach: Record<"onPointerEnter" | "onPointerLeave" | "onFocus" | "onBlur", () => void>;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" {...reach} onClick={onClick} className="btn-solid paywall-btn mt-7">
      {children} <ArrowRight className="paywall-arrow size-5" />
    </button>
  );
}

/** A bare link under the button: dark bold text, its icon wiggles on hover. */
function PaywallLink({
  icon: Icon,
  onClick,
  children,
}: {
  icon: LucideIcon;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className="paywall-link">
      <Icon className="size-4" /> {children}
    </button>
  );
}
