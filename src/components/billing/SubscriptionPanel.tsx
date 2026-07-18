import { useState } from "react";
import { ExternalLink, Loader2, PauseCircle, PlayCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { isSubscriptionLive, openBillingPortal, type BillingReturnTo } from "@/lib/billing";
import { useManageSubscription } from "@/hooks/data/useBilling";
import type { SubscriptionRow } from "@/lib/billing";

interface SubscriptionPanelProps {
  sub: SubscriptionRow;
  /** Human name of the plan (falls back to the raw tier). */
  planName: string;
  /** Whether the signed-in user is the payer. Non-payers get status only. */
  isPayer: boolean;
  /** Where Stripe should send the browser back to after the portal. */
  returnTo: BillingReturnTo;
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
export function SubscriptionPanel({ sub, planName, isPayer, returnTo }: SubscriptionPanelProps) {
  const manage = useManageSubscription();
  const [confirming, setConfirming] = useState<"cancel" | "pause" | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);

  const live = isSubscriptionLive(sub.status);
  const paused = sub.status === "paused";
  const endsAt = sub.current_period_end ? new Date(sub.current_period_end) : null;
  // Manually-granted rows (grandfathered access) have no Stripe subscription:
  // there is nothing to pause, cancel, or open a portal for.
  const manageable = isPayer && !!sub.stripe_subscription_id;

  const run = (action: "cancel" | "pause" | "resume") => {
    setConfirming(null);
    manage.mutate(
      { action, studentId: sub.student_id },
      {
        onSuccess: () => {
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
              onClick={() => setConfirming("pause")}
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

      {confirming && (
        <div className="mt-3 rounded-xl border border-border bg-muted/50 p-4 text-sm">
          <p className="font-semibold mb-1">
            {confirming === "cancel" ? "Cancel this plan?" : "Pause this plan?"}
          </p>
          <p className="text-muted-foreground">
            {confirming === "cancel"
              ? `Access continues until ${endsAt ? endsAt.toLocaleDateString() : "the end of the current period"}, then stops. You can resume any time before then.`
              : "Payments stop immediately and access is suspended until you resume. Nothing is lost — progress and history are kept."}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => run(confirming)}
              className="h-9 px-3.5 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:opacity-90"
            >
              Yes, {confirming}
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
    </div>
  );
}
