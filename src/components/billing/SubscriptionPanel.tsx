import { useState } from "react";
import { ExternalLink, Loader2, PauseCircle, PlayCircle, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { isSubscriptionLive, openBillingPortal, type BillingReturnTo } from "@/lib/billing";
import { useManageSubscription } from "@/hooks/data/useBilling";
import { DeleteSubscriptionDialog } from "@/components/billing/DeleteSubscriptionDialog";
import { PlanFeedbackDialog } from "@/components/billing/PlanFeedbackDialog";
import { recordBillingFeedback } from "@/lib/billingFeedback";
import type { SubscriptionRow } from "@/lib/billing";

interface SubscriptionPanelProps {
  sub: SubscriptionRow;
  /** Human name of the plan (falls back to the raw tier). */
  planName: string;
  /** Whether the signed-in user is the payer. Non-payers get status only. */
  isPayer: boolean;
  /**
   * Whether the signed-in user is a parent. Pausing and deleting are
   * parent-only, so a self-paying student (isPayer but not isParent) can still
   * cancel/resume/open the portal but never pause or delete.
   */
  isParent: boolean;
  /** Where Stripe should send the browser back to after the portal. */
  returnTo: BillingReturnTo;
  /** Whose plan it is (e.g. a child's name), for the delete dialog copy. */
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
 * and a jump into the Stripe billing portal for everything else (card changes,
 * VAT details, immediate cancellation).
 *
 * Rendered on the student billing page (own plan) and on the parent dashboard
 * (one per funded child). The payer check is enforced server-side too — this
 * component hiding buttons is UX, not security.
 */
export function SubscriptionPanel({
  sub,
  planName,
  isPayer,
  isParent,
  returnTo,
  ownerLabel,
}: SubscriptionPanelProps) {
  const manage = useManageSubscription();
  const [confirming, setConfirming] = useState<"cancel" | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showPause, setShowPause] = useState(false);

  const live = isSubscriptionLive(sub.status);
  const paused = sub.status === "paused";
  const endsAt = sub.current_period_end ? new Date(sub.current_period_end) : null;
  // Controls only make sense against a real Stripe subscription: a row without
  // one has nothing to pause, cancel, or open a portal for.
  const manageable = isPayer && !!sub.stripe_subscription_id;
  // Pause and delete are parent-only, on top of being payer-only.
  const canPauseOrDelete = manageable && isParent;

  const run = (action: "cancel" | "pause" | "resume") => {
    setConfirming(null);
    manage.mutate(
      { action, studentId: sub.student_id },
      {
        onSuccess: () => {
          setShowPause(false);
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

  // Record why the family is pausing (parent-only, enforced by RLS), then pause.
  const confirmPause = (category: string, comment: string) => {
    void recordBillingFeedback({ studentId: sub.student_id, action: "pause", category, comment });
    run("pause");
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

          {live && !sub.cancel_at_period_end && canPauseOrDelete && (
            <button
              onClick={() => setShowPause(true)}
              disabled={manage.isPending}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              <PauseCircle className="w-4 h-4" /> Pause
            </button>
          )}

          {(live || paused) && !sub.cancel_at_period_end && (
            <button
              onClick={() => setConfirming("cancel")}
              disabled={manage.isPending}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-rose-200 text-rose-600 text-sm font-semibold hover:bg-rose-50 disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" /> Cancel
            </button>
          )}

          <button
            onClick={portal}
            disabled={portalBusy}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-50"
          >
            {portalBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Billing portal <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {confirming === "cancel" && (
        <div className="mt-3 rounded-xl border border-border bg-muted/50 p-4 text-sm">
          <p className="font-semibold mb-1">Cancel this plan?</p>
          <p className="text-muted-foreground">
            Access continues until{" "}
            {endsAt ? endsAt.toLocaleDateString() : "the end of the current period"}, then stops.
            You can resume any time before then.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => run("cancel")}
              className="h-9 px-3.5 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:opacity-90"
            >
              Yes, cancel
            </button>
            <button
              onClick={() => setConfirming(null)}
              className="h-9 px-3.5 rounded-lg border border-border text-sm font-semibold hover:bg-muted"
            >
              Keep plan
            </button>
          </div>
        </div>
      )}

      {/* Danger zone: permanent deletion, kept visually and behaviourally
          apart from the everyday cancel/pause controls above. The heavy
          consent flow lives in the dialog. */}
      {canPauseOrDelete && (
        <div className="mt-5 border-t border-border pt-4">
          <button
            onClick={() => setShowDelete(true)}
            disabled={manage.isPending}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:underline disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete subscription
          </button>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-md">
            Permanently ends this plan immediately (GDPR erasure request). Cancelling keeps access
            until the period ends and is usually the better option.
          </p>
        </div>
      )}

      {showPause && (
        <PlanFeedbackDialog
          planName={planName}
          ownerLabel={ownerLabel}
          pending={manage.isPending}
          onConfirm={confirmPause}
          onClose={() => setShowPause(false)}
        />
      )}

      {showDelete && (
        <DeleteSubscriptionDialog
          studentId={sub.student_id}
          planName={planName}
          ownerLabel={ownerLabel}
          onCancelInstead={() => {
            setShowDelete(false);
            run("cancel");
          }}
          onClose={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}
