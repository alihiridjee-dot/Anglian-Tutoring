import { Loader2 } from "lucide-react";

/**
 * Back from Stripe, before the webhook has written the plan.
 *
 * Shown in place of "you don't have a plan" and the plan picker beneath it —
 * on the student's Billing page and on each child's card in the parent tab —
 * because the one thing that must not be on screen just after paying is a
 * button to pay again. See `useCheckoutReturn`.
 */
export function PaymentPending({ delayed, onRetry }: { delayed: boolean; onRetry: () => void }) {
  if (delayed) {
    return (
      <div>
        <p className="font-semibold">We haven&apos;t had confirmation of your payment yet.</p>
        <p className="mt-1 text-sm">
          You don&apos;t need to pay again. It can take a minute to reach us.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="btn-soft mt-3 inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold sm:h-9"
        >
          Check again
        </button>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 font-semibold">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Confirming your payment…
    </p>
  );
}
