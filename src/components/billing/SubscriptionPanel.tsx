import { useState } from "react";
import { ExternalLink, Loader2, PauseCircle, PlayCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { isSubscriptionLive, openBillingPortal, type BillingReturnTo } from "@/lib/billing";
import { useManageSubscription } from "@/hooks/data/useBilling";
import { PlanFeedbackDialog } from "@/components/billing/PlanFeedbackDialog";
import { recordBillingFeedback, type BillingFeedbackAction } from "@/lib/billingFeedback";
import type { SubscriptionRow } from "@/lib/billing";

interface SubscriptionPanelProps {
  sub: SubscriptionRow;
  /** Human name of the plan (falls back to the raw tier). */
  planName: string;
  /**
   * Whether the signed-in user may manage the plan's lifecycle (pause, resume,
   * cancel). Link-based, not payer-based: the linked parent manages it, or the
   * student themselves while no parent is linked. A student with a linked parent
   * gets `false` and sees status only, even if they paid originally.
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
  /** Whose plan it is (e.g. a child's name), for the feedback dialog copy. */
  ownerLabel?: string;
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

function statusBadgeClass(status: string) {
  if (isSubscriptionLive(status)) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "paused") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

/**
 * Status + controls for one subscription: pause, resume, cancel at period end,
 * and a jump into the Stripe billing portal for card/VAT changes.
 *
 * Cancelling is the only way to end a plan — there is no delete — and both
 * pausing and cancelling are gated behind a feedback form (PlanFeedbackDialog)
 * so neither is a one-click action.
 *
 * Rendered on the student billing page (own plan) and on the parent dashboard
 * (one per funded child). The link-based authority is enforced server-side too
 * — this component hiding buttons is UX, not security.
 */
export function SubscriptionPanel({
  sub,
  planName,
  canManage,
  isPayer,
  returnTo,
  ownerLabel,
}: SubscriptionPanelProps) {
  const manage = useManageSubscription();
  // Which lifecycle action's feedback gate is open (pause or cancel), if any.
  const [feedbackFor, setFeedbackFor] = useState<BillingFeedbackAction | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);

  const live = isSubscriptionLive(sub.status);
  const paused = sub.status === "paused";
  const endsAt = sub.current_period_end ? new Date(sub.current_period_end) : null;
  // Controls only make sense against a real Stripe subscription: a row without
  // one has nothing to pause or cancel. Lifecycle control is link-based
  // (canManage). Within that, the Stripe portal — which itself allows self-serve
  // cancellation — is only shown to the payer, so a non-paying manager never
  // reaches someone else's card and a linked student never gets a back door.
  const manageable = canManage && !!sub.stripe_subscription_id;

  const run = (action: "cancel" | "pause" | "resume") => {
    manage.mutate(
      { action, studentId: sub.student_id },
      {
        onSuccess: () => {
          setFeedbackFor(null);
          toast.success(
            action === "cancel"
              ? "Plan will end at the current period — no further charges."
              : action === "pause"
                ? "Plan paused. No payments will be taken until you resume."
                : "Plan resumed — welcome back!",
          );
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  // Record why the family is pausing/cancelling (manager-only, enforced by RLS),
  // then run it. This is the friction gate on both actions.
  const confirmFeedback = (category: string, comment: string) => {
    if (!feedbackFor) return;
    void recordBillingFeedback({
      studentId: sub.student_id,
      action: feedbackFor,
      category,
      comment,
    });
    run(feedbackFor);
  };

  const portal = async () => {
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
      <div className="flex items-center gap-2 flex-wrap">
        <p className="font-semibold text-lg">{planName}</p>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${statusBadgeClass(sub.status)}`}
        >
          {STATUS_LABELS[sub.status] ?? sub.status}
        </span>
      </div>

      {endsAt && (
        <p className="text-sm text-muted-foreground mt-1">
          {sub.cancel_at_period_end
            ? `Access ends ${endsAt.toLocaleDateString()} — no further charges.`
            : paused
              ? `Paused — was due to renew ${endsAt.toLocaleDateString()}.`
              : `Renews ${endsAt.toLocaleDateString()}.`}
        </p>
      )}

      {manageable && (
        <div className="mt-4 flex flex-wrap gap-2">
          {(paused || sub.cancel_at_period_end) && (
            <button
              onClick={() => run("resume")}
              disabled={manage.isPending}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {manage.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <PlayCircle className="w-4 h-4" />
              )}
              Resume plan
            </button>
          )}

          {live && !sub.cancel_at_period_end && (
            <button
              onClick={() => setFeedbackFor("pause")}
              disabled={manage.isPending}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              <PauseCircle className="w-4 h-4" /> Pause
            </button>
          )}

          {(live || paused) && !sub.cancel_at_period_end && (
            <button
              onClick={() => setFeedbackFor("cancel")}
              disabled={manage.isPending}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-rose-200 text-rose-600 text-sm font-semibold hover:bg-rose-50 disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" /> Cancel
            </button>
          )}

          {isPayer && (
            <button
              onClick={portal}
              disabled={portalBusy}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              {portalBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Billing portal <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {feedbackFor && (
        <PlanFeedbackDialog
          action={feedbackFor}
          planName={planName}
          ownerLabel={ownerLabel}
          endsAtLabel={endsAt?.toLocaleDateString()}
          pending={manage.isPending}
          onConfirm={confirmFeedback}
          onClose={() => setFeedbackFor(null)}
        />
      )}
    </div>
  );
}
