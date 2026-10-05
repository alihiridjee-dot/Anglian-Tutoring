import { useState } from "react";
import { ExternalLink, Loader2, PlayCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  isPaymentOverdue,
  isPlanChangeable,
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
   * pause and cancel in PlanLifecycleActions). True for the PAYER — always, since nobody may be charged with no
   * way to stop — and for a linked parent of the student. False only for a
   * student on a plan someone else pays for.
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
   * Whether the viewer may move a subject to a different board. Student-only:
   * RLS lets nobody but the student write their own enrolment rows. When set,
   * the board tile offers a jump to the controls in EnrolledSubjectsCard.
   */
  canChangeBoard?: boolean;
  /**
   * DOM id of the matching EnrolledSubjectsCard, for the board and subjects
   * jumps. Per-child on the parent tab, which renders several.
   */
  subjectsAnchorId?: string;
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
 * What one subscription is: name, status, price, the course and billing facts,
 * plus Resume and the Stripe billing portal.
 *
 * Pause and cancel are deliberately not here. They live in
 * PlanLifecycleActions, which each page puts at the very bottom, under the
 * subjects, the add-subject card and the invoices.
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
  canChangeBoard = false,
  subjectsAnchorId = "subjects",
}: SubscriptionPanelProps) {
  const manage = useManageSubscription();
  const [portalBusy, setPortalBusy] = useState(false);
  // Back from the Stripe portal restores this page as it was left — busy and all.
  usePageRestore(() => setPortalBusy(false));

  const paused = sub.status === "paused";
  const endsAt = sub.current_period_end ? new Date(sub.current_period_end) : null;
  const endsAtLabel = endsAt?.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  // Controls only make sense against a real Stripe subscription.
  const manageable = canManage && !!sub.stripe_subscription_id;
  // Subjects only change on a live plan that isn't cancelling; the server
  // refuses the rest, so nothing here points there.
  const changeable = isPlanChangeable(sub);

  const resume = () => {
    manage.mutate(
      { action: "resume", studentId: sub.student_id },
      {
        onSuccess: () => toast.success("Plan resumed — welcome back!"),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  // EnrolledSubjectsCard owns the board and subject controls, and renders under
  // #subjects on both personas' pages.
  const goToSubjects = () => {
    document
      .getElementById(subjectsAnchorId)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <p className="font-display text-lg font-bold">{planName}</p>
        <span className={`chip ${statusTint(sub.status)} text-[10px] uppercase tracking-wider`}>
          {STATUS_LABELS[sub.status] ?? sub.status}
        </span>
      </div>

      {priceLabel && <p className="font-display text-2xl font-bold mt-1">{priceLabel}</p>}

      {/* A failed card is fixed in the portal, by whoever owns the card — say
          which, so nobody reaches for the shop instead. */}
      {isPaymentOverdue(sub.status) && (
        <div className="tint-rose pop-card mt-4 flex items-start gap-3 p-4 text-sm">
          <span className="icon-tile size-8 shrink-0 text-base font-black">!</span>
          <div className="min-w-0 flex-1">
            <p className="font-display font-bold text-[color:var(--tint)]">
              The last payment didn&apos;t go through
            </p>
            <p className="text-muted-foreground mt-0.5 leading-relaxed">
              {isPayer
                ? "Update the card under Card & invoices below and Stripe will take the payment again."
                : `Ask ${payerLabel ?? "whoever pays for this plan"} to update the card from their own Billing tab.`}
            </p>
          </div>
        </div>
      )}

      {/* What the plan teaches, when it next bills and who pays — one row of
          chips, then the subjects, then the two controls that change them. */}
      <PlanFacts
        course={course}
        payerLabel={payerLabel}
        billingLabel={sub.cancel_at_period_end ? "Access ends" : paused ? "Was due" : "Next bill"}
        billingValue={endsAtLabel}
        onChangeBoard={canChangeBoard ? goToSubjects : undefined}
        onManageSubjects={canManage && changeable ? goToSubjects : undefined}
      />

      {manageable && (
        <div className="mt-4 flex flex-wrap gap-2">
          {isResumable(sub) && (
            <button
              onClick={resume}
              disabled={manage.isPending}
              className="inline-flex items-center gap-1.5 h-11 sm:pointer-fine:h-9 px-3.5 rounded-lg btn-solid text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {manage.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <PlayCircle className="w-4 h-4" />
              )}
              Resume plan
            </button>
          )}

          {isPayer && (
            <button
              onClick={async () => {
                setPortalBusy(true);
                try {
                  await openBillingPortal(returnTo);
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Couldn't open the billing portal.",
                  );
                  setPortalBusy(false);
                }
              }}
              disabled={portalBusy}
              className="inline-flex items-center gap-1.5 h-11 sm:pointer-fine:h-9 px-3.5 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              {portalBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              Card &amp; invoices <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
