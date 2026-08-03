import { useState } from "react";
import {
  CreditCard,
  ExternalLink,
  Loader2,
  PauseCircle,
  PlayCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { isSubscriptionLive, openBillingPortal, type BillingReturnTo } from "@/lib/billing";
import { useManageSubscription } from "@/hooks/data/useBilling";
import { PlanFeedbackDialog } from "@/components/billing/PlanFeedbackDialog";
import { CancelPlanDialog } from "@/components/billing/CancelPlanDialog";
import { recordBillingFeedback } from "@/lib/billingFeedback";
import type { SubscriptionRow } from "@/lib/billing";

interface SubscriptionPanelProps {
  sub: SubscriptionRow;
  /** Human name of the plan (falls back to the raw tier). */
  planName: string;
  /**
   * Whether the signed-in user may manage the plan's lifecycle (pause, resume,
   * cancel). True for the PAYER — always, since nobody may be charged with no
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
  /** Whose plan it is (e.g. a child's name), for the feedback dialog copy. */
  ownerLabel?: string;
  /** Who the card belongs to — "You", "Mum", … Rendered in the Paid by row. */
  payerLabel?: string;
  /** Formatted recurring price, e.g. "£89.99 per month". */
  priceLabel?: string;
  /** Subjects the plan covers, for the cancel dialog's consequence list. */
  subjectLabels?: string[];
  /**
   * DOM id of the matching EnrolledSubjectsCard, for the cancel dialog's "drop a
   * subject instead" jump. Per-child on the parent tab, which renders several.
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

function statusBadgeClass(status: string) {
  if (isSubscriptionLive(status)) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "paused") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

/**
 * Status + controls for one subscription: what it is, who pays for it, and the
 * lifecycle actions (resume, pause, cancel) plus the Stripe billing portal.
 *
 * The two destructive actions live in their own bordered strip at the bottom
 * rather than in the same row as the portal link, and both are gated: pausing by
 * a one-screen reason form, cancelling by the four-step CancelPlanDialog. There
 * is still no delete — cancelling runs access to the period boundary.
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
  ownerLabel,
  payerLabel,
  priceLabel,
  subjectLabels = [],
  subjectsAnchorId = "subjects",
}: SubscriptionPanelProps) {
  const manage = useManageSubscription();
  const [pauseOpen, setPauseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);

  const live = isSubscriptionLive(sub.status);
  const paused = sub.status === "paused";
  const endsAt = sub.current_period_end ? new Date(sub.current_period_end) : null;
  const endsAtLabel = endsAt?.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  // Controls only make sense against a real Stripe subscription: a row without
  // one has nothing to pause or cancel.
  const manageable = canManage && !!sub.stripe_subscription_id;
  const canPause = live && !sub.cancel_at_period_end;
  const canCancel = (live || paused) && !sub.cancel_at_period_end;

  const run = (action: "cancel" | "pause" | "resume") => {
    manage.mutate(
      { action, studentId: sub.student_id },
      {
        onSuccess: () => {
          setPauseOpen(false);
          setCancelOpen(false);
          toast.success(
            action === "cancel"
              ? `Plan will end ${endsAtLabel ?? "at the end of the period"} — no further charges.`
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
  // then run it. Best-effort: a lost feedback row never blocks the action.
  const confirmWith = (action: "pause" | "cancel") => (category: string, comment: string) => {
    void recordBillingFeedback({ studentId: sub.student_id, action, category, comment });
    run(action);
  };

  // "Drop a subject instead" hands them to EnrolledSubjectsCard, which owns the
  // removal flow and renders under #subjects on both personas' pages.
  const goToSubjects = () => {
    setCancelOpen(false);
    document
      .getElementById(subjectsAnchorId)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
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

      {priceLabel && <p className="font-display text-2xl font-bold mt-1">{priceLabel}</p>}

      {endsAtLabel && (
        <p className="text-sm text-muted-foreground mt-1">
          {sub.cancel_at_period_end
            ? `Access ends ${endsAtLabel} — no further charges.`
            : paused
              ? `Paused — was due to renew ${endsAtLabel}.`
              : `Renews ${endsAtLabel}.`}
        </p>
      )}

      {/* Who is actually paying, stated rather than left to be inferred. On a
          household plan this is the first question anyone has, and getting it
          wrong is what makes a student think they can't stop the charges. */}
      {payerLabel && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">
            Paid by <strong className="text-foreground font-semibold">{payerLabel}</strong>
            {isPayer && canManage && " — you can change or stop it any time"}
          </span>
        </div>
      )}

      {manageable && (
        <>
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
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-50"
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

          {/* The two destructive actions, kept apart from the everyday ones so
              neither is a slip of the mouse away from the portal button. */}
          {(canPause || canCancel) && (
            <div className="mt-5 rounded-xl border border-rose-200/70 bg-rose-50/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-rose-700">
                Stop or take a break
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Pausing is instant and reversible. Cancelling runs the plan to{" "}
                {endsAtLabel ?? "the end of the period"} and then stops it.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {canPause && (
                  <button
                    onClick={() => setPauseOpen(true)}
                    disabled={manage.isPending}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-50"
                  >
                    <PauseCircle className="w-4 h-4 text-amber-600" /> Pause plan
                  </button>
                )}
                {canCancel && (
                  <button
                    onClick={() => setCancelOpen(true)}
                    disabled={manage.isPending}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-rose-300 bg-card text-rose-600 text-sm font-semibold hover:bg-rose-50 disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" /> Cancel plan
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {pauseOpen && (
        <PlanFeedbackDialog
          action="pause"
          planName={planName}
          ownerLabel={ownerLabel}
          endsAtLabel={endsAtLabel}
          pending={manage.isPending}
          onConfirm={confirmWith("pause")}
          onClose={() => setPauseOpen(false)}
        />
      )}

      {cancelOpen && (
        <CancelPlanDialog
          planName={planName}
          ownerLabel={ownerLabel}
          endsAtLabel={endsAtLabel}
          subjectLabels={subjectLabels}
          pending={manage.isPending}
          canPauseInstead={canPause}
          canRemoveInstead={subjectLabels.length > 1}
          onPauseInstead={() => {
            setCancelOpen(false);
            setPauseOpen(true);
          }}
          onRemoveInstead={goToSubjects}
          onConfirm={confirmWith("cancel")}
          onClose={() => setCancelOpen(false)}
        />
      )}
    </div>
  );
}
