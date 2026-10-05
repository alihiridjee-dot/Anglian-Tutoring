import { useState } from "react";
import { ExternalLink, Loader2, PlayCircle, ShieldCheck } from "lucide-react";
import { CourseChip } from "@/components/CourseBadge";
import { toast } from "sonner";
import {
  isPaymentOverdue,
  isResumable,
  isSubscriptionLive,
  openBillingPortal,
  type BillingReturnTo,
} from "@/lib/billing/billing";
import { useManageSubscription } from "@/hooks/data/useBilling";
import { usePageRestore } from "@/hooks/usePageRestore";
import { PlanFacts } from "@/components/billing/PlanFacts";
import type { CourseSummary } from "@/lib/curriculum/courseSummary";
import type { SubscriptionRow } from "@/lib/billing/billing";

interface SubscriptionPanelProps {
  sub: SubscriptionRow;
  /** Human name of the plan (falls back to the raw tier). */
  planName: string;
  /**
   * Whether the signed-in user may manage the plan's lifecycle (resume here;
   * pause and cancel in PlanLifecycleActions). True for the PAYER — always,
   * since nobody may be charged with no way to stop — and for a linked parent of
   * the student. False only for a student on a plan someone else pays for.
   */
  canManage: boolean;
  /**
   * Whether the signed-in user is the payer, i.e. the plan sits on their own
   * Stripe customer. Only the payer is offered the Stripe billing portal (cards,
   * VAT, invoices) — a managing parent who didn't pay can still pause/cancel but
   * has no portal for someone else's card.
   */
  isPayer: boolean;
  /** Where Stripe should send the browser back to after the portal. */
  returnTo: BillingReturnTo;
  /** Who the card belongs to — "You", "Mum", … Rendered in the Paid by row. */
  payerLabel?: string;
  /** Formatted recurring price, e.g. "£89.99 per month". */
  priceLabel?: string;
  /**
   * The exam course the plan teaches — level, and the board of each subject.
   *
   * A plan name ("2 Subjects, Monthly") says what is being paid for but not
   * what is being taught, and the level and board are what decide every piece of
   * content on the account. Stating them here means the first place anyone
   * checks their subscription is also the place they can catch a wrong board —
   * and, for a student, fix it.
   */
  course?: CourseSummary;
  /**
   * Show the subjects as chips. Only where no Subjects block follows — the
   * tutor's record page, or an overdue plan — since that block is the better
   * home for them everywhere else.
   */
  showSubjects?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  paused: "Paused",
  past_due: "Payment overdue",
  unpaid: "Unpaid",
  canceled: "Cancelled",
  incomplete: "Incomplete",
};

function statusTint(status: string) {
  if (isSubscriptionLive(status)) return "tint-emerald";
  if (status === "paused") return "tint-amber";
  return "tint-rose";
}

/**
 * What one subscription is, as tiles: a header tile with the name, status,
 * price and course, then Next bill, Paid by and (for the payer) Card &
 * invoices. Resume sits in the header tile when the plan is paused.
 *
 * Pause and cancel are deliberately not here. They live in
 * PlanLifecycleActions, which each page puts at the very bottom.
 *
 * Rendered on the student billing page (own plan) and on the parent billing tab
 * (one per linked child). Authority is enforced server-side too — this component
 * hiding buttons is UX, not security.
 */
export function SubscriptionPanel({
  sub,
  planName,
  canManage,
  isPayer,
  returnTo,
  payerLabel,
  priceLabel,
  course,
  showSubjects = false,
}: SubscriptionPanelProps) {
  const manage = useManageSubscription();
  const [portalBusy, setPortalBusy] = useState(false);
  // Back from the Stripe portal restores this page as it was left — busy and all.
  usePageRestore(() => setPortalBusy(false));

  const paused = sub.status === "paused";
  const endsAt = sub.current_period_end ? new Date(sub.current_period_end) : null;
  // Short enough to sit large in a tile; the year only when it isn't this one.
  const endsAtShort = endsAt?.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(endsAt.getFullYear() !== new Date().getFullYear() && { year: "numeric" }),
  });
  // Controls only make sense against a real Stripe subscription.
  const manageable = canManage && !!sub.stripe_subscription_id;

  const resume = () => {
    manage.mutate(
      { action: "resume", studentId: sub.student_id },
      {
        onSuccess: () => toast.success("Plan resumed — welcome back!"),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const openPortal = async () => {
    setPortalBusy(true);
    try {
      await openBillingPortal(returnTo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open the billing portal.");
      setPortalBusy(false);
    }
  };

  return (
    <div>
      <div className="pop-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display text-lg font-bold">{planName}</p>
              <span className={`chip ${statusTint(sub.status)} uppercase`}>
                {STATUS_LABELS[sub.status] ?? sub.status}
              </span>
            </div>
            {priceLabel && <p className="numeral mt-1 text-3xl">{priceLabel}</p>}
            {course?.levelLabel && (
              <CourseChip
                icon
                className="mt-3"
                parts={[course.levelLabel, course.mixedBoards ? null : course.boardSummary]}
              />
            )}
          </div>
          {manageable && isResumable(sub) && (
            <button
              type="button"
              onClick={resume}
              disabled={manage.isPending}
              className="btn-solid inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-sm sm:pointer-fine:h-9"
            >
              {manage.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <PlayCircle className="size-4" aria-hidden />
              )}
              Resume plan
            </button>
          )}
        </div>
      </div>

      {/* A failed card is fixed in the portal, by whoever owns the card — say
          which, so nobody reaches for the shop instead. */}
      {isPaymentOverdue(sub.status) && (
        <div className="tint-rose pop-card mt-3 flex items-start gap-3 p-4 text-sm">
          <span className="icon-tile size-8 shrink-0 text-base font-black">!</span>
          <div className="min-w-0 flex-1">
            <p className="font-display font-bold text-[color:var(--tint)]">
              The last payment didn&apos;t go through
            </p>
            <p className="mt-0.5 leading-relaxed">
              {isPayer
                ? "Update the card under Card & invoices and Stripe will take the payment again."
                : `Ask ${payerLabel ?? "whoever pays for this plan"} to update the card from their own Billing tab.`}
            </p>
          </div>
        </div>
      )}

      <PlanFacts
        payerLabel={payerLabel}
        billingLabel={sub.cancel_at_period_end ? "Access ends" : paused ? "Was due" : "Next bill"}
        billingValue={endsAtShort}
        subjectsCourse={showSubjects ? course : undefined}
        extraTile={
          manageable && isPayer ? (
            <button
              type="button"
              onClick={() => void openPortal()}
              disabled={portalBusy}
              className="pop-card pop-card-interactive col-span-2 flex flex-col items-start justify-between gap-3 p-4 text-left disabled:opacity-50 sm:col-span-1 sm:p-5"
            >
              <span className="icon-tile size-8">
                {portalBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <ShieldCheck className="size-4" aria-hidden />
                )}
              </span>
              <span className="font-display inline-flex items-center gap-1.5 text-lg font-bold">
                Card &amp; invoices <ExternalLink className="size-4" aria-hidden />
              </span>
            </button>
          ) : undefined
        }
      />
    </div>
  );
}
