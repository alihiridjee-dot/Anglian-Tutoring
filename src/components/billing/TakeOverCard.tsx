import { useState } from "react";
import { ArrowRightLeft, CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { usePageRestore } from "@/hooks/usePageRestore";
import { startCheckout, type SubscriptionRow } from "@/lib/billing/billing";

/**
 * Stripe's shortest delayed start is 48 hours; a plan with less left is taken
 * over from then (stripe-checkout/takeOver.ts), so that is the day to name.
 */
const MIN_START_MS = 48 * 3600 * 1000 + 10 * 60 * 1000;

/**
 * The server refuses a take-over in the last six hours before the child's plan
 * renews (TAKE_OVER_LEAD_SECONDS in takeOver.ts), so the card isn't offered then.
 */
const LEAD_MS = 6 * 3600 * 1000;

/**
 * Offered to a linked parent when the child pays for their own plan — often a
 * parent's card typed into the child's checkout, which leaves the parent
 * unable to see its invoices or change its card. One press moves the plan to
 * the parent's own card: nothing is taken until the child's current plan runs
 * out, and that plan then ends by itself (the webhook's take-over rules).
 */
export function TakeOverCard({
  sub,
  childName,
  tier,
  priceLabel,
}: {
  /** The child's live plan, on the child's own account. */
  sub: SubscriptionRow;
  childName: string;
  /** The tier the parent's plan is bought at: the same cadence and subjects. */
  tier: string;
  /** Formatted recurring price, e.g. "£55.99 per month". */
  priceLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  // Back from Stripe restores this page as it was left — spinner and all.
  usePageRestore(() => setBusy(false));

  const ends = sub.current_period_end ? new Date(sub.current_period_end).getTime() : null;
  const starts = ends ? new Date(Math.max(ends, Date.now() + MIN_START_MS)) : null;
  const startDay = starts?.toLocaleDateString("en-GB", { day: "numeric", month: "long" });

  if (ends !== null && ends - Date.now() < LEAD_MS) return null;

  const moveToMyCard = async () => {
    setBusy(true);
    try {
      await startCheckout({
        tier,
        studentId: sub.student_id,
        returnTo: "billing",
        takeOver: true,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open checkout — try again.");
      setBusy(false);
    }
  };

  return (
    <div className="pop-card tint-primary mb-6 flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
      <span className="icon-tile size-10 shrink-0">
        <CreditCard className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-bold">Pay for {childName}&apos;s plan yourself</h3>
        <p className="mt-1 text-[0.9375rem] leading-relaxed">
          This plan is paid from {childName}&apos;s own account. Move it to your card to manage it
          here. Nothing is taken until {startDay ?? "the current plan runs out"}
          {startDay && ", when the current plan runs out"}
          {priceLabel ? `. Then it's ${priceLabel}.` : "."}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void moveToMyCard()}
        disabled={busy}
        className="btn-solid inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <ArrowRightLeft className="size-4" aria-hidden />
        )}
        Move to my card
      </button>
    </div>
  );
}
