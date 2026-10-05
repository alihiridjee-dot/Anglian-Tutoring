import { useState } from "react";
import {
  ChevronDown,
  CreditCard,
  ExternalLink,
  Loader2,
  PlayCircle,
  Repeat,
  ShieldCheck,
} from "lucide-react";
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
import { CADENCES, planCadence, planSubjectCount } from "@/lib/billing/entitlements";
import type { CourseSummary } from "@/lib/curriculum/courseSummary";
import type { SubscriptionRow } from "@/lib/billing/billing";

interface SubscriptionPanelProps {
  sub: SubscriptionRow;
  /** The fold-away row's title — "Your plan", or "Plan" under a child's name. */
  title?: string;
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
  /**
   * The CadenceSwitcher, opened by the Switch payment tile. Omitted where the
   * cadence can't change (paused or ending plan, or a viewer who can't manage).
   */
  cadenceSwitcher?: React.ReactNode;
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
 * The plan, folded away under one row ("Your plan · £55.99 per month") since
 * the Subjects block above it is what families come for. Opened, it is a grid
 * of tiles: subject count, next bill, who pays, Card & invoices (payer only)
 * and Switch payment, which opens the three cadences in place.
 *
 * Opens by itself when it needs attention: a paused plan (Resume lives here)
 * or an overdue payment (the card fix does).
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
  title = "Your plan",
  canManage,
  isPayer,
  returnTo,
  payerLabel,
  priceLabel,
  course,
  showSubjects = false,
  cadenceSwitcher,
}: SubscriptionPanelProps) {
  const manage = useManageSubscription();
  const [portalBusy, setPortalBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
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

  const overdue = isPaymentOverdue(sub.status);
  const cadenceLabel = CADENCES.find((c) => c.key === planCadence(sub.plan))?.label;
  const subjectCount = course?.perSubject.length || planSubjectCount(sub.plan);
  const tileClass =
    "pop-card pop-card-interactive flex flex-col items-start justify-between gap-3 p-4 text-left disabled:opacity-50 sm:p-5";

  return (
    <details className="group pop-card p-4 sm:p-5" open={paused || overdue}>
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 sm:pointer-fine:min-h-0 [&::-webkit-details-marker]:hidden">
        <span className="icon-tile size-8 shrink-0">
          <CreditCard className="size-4" aria-hidden />
        </span>
        <h2 className="text-xl font-bold">{title}</h2>
        {priceLabel && <span className="font-display text-lg font-bold">{priceLabel}</span>}
        <span className={`chip ${statusTint(sub.status)} uppercase`}>
          {STATUS_LABELS[sub.status] ?? sub.status}
        </span>
        <ChevronDown
          className="ml-auto size-5 shrink-0 transition group-open:rotate-180"
          aria-hidden
        />
      </summary>

      {manageable && isResumable(sub) && (
        <button
          type="button"
          onClick={resume}
          disabled={manage.isPending}
          className="btn-solid mt-4 inline-flex h-11 items-center gap-1.5 rounded-lg px-3.5 text-sm sm:pointer-fine:h-9"
        >
          {manage.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <PlayCircle className="size-4" aria-hidden />
          )}
          Resume plan
        </button>
      )}

      {/* A failed card is fixed in the portal, by whoever owns the card — say
          which, so nobody reaches for the shop instead. */}
      {overdue && (
        <div className="tint-rose pop-card mt-4 flex items-start gap-3 p-4 text-sm">
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

      <div className="mt-1">
        <PlanFacts
          subjectCount={subjectCount}
          payerLabel={payerLabel}
          billingLabel={sub.cancel_at_period_end ? "Access ends" : paused ? "Was due" : "Next bill"}
          billingValue={endsAtShort}
          subjectsCourse={showSubjects ? course : undefined}
          extraTiles={
            <>
              {manageable && isPayer && (
                <button
                  type="button"
                  onClick={() => void openPortal()}
                  disabled={portalBusy}
                  className={tileClass}
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
              )}
              {cadenceSwitcher && (
                <button
                  type="button"
                  onClick={() => setSwitching((v) => !v)}
                  aria-expanded={switching}
                  className={`${tileClass} ${switching ? "pop-card-hero tint-primary" : ""}`}
                >
                  <span className="flex w-full items-start justify-between gap-2">
                    <span className="icon-tile size-8">
                      <Repeat className="size-4" aria-hidden />
                    </span>
                    {cadenceLabel && <span className="chip tint-primary">{cadenceLabel}</span>}
                  </span>
                  <span className="font-display text-lg font-bold">Switch payment</span>
                </button>
              )}
            </>
          }
        />
      </div>

      {switching && cadenceSwitcher && <div className="mt-4">{cadenceSwitcher}</div>}
    </details>
  );
}
