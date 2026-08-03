import { useState } from "react";
import { Loader2, PauseCircle, X } from "lucide-react";
import { BILLING_FEEDBACK_REASONS } from "@/lib/billingFeedback";

interface PlanFeedbackDialogProps {
  /**
   * Which lifecycle action this gate fronts. Pause only — cancelling outgrew a
   * single screen and moved to CancelPlanDialog, and dropping a subject has
   * RemoveSubjectDialog. Narrowed rather than dropped so a call site can't quietly
   * reuse this form for a heavier action.
   */
  action: "pause";
  /** Human plan name, shown so the user knows what they're acting on. */
  planName: string;
  /** Whose plan it is ("Alex's plan") for the parent view. Omit for own plan. */
  ownerLabel?: string;
  /** Formatted period-end date, shown in the cancel copy. */
  endsAtLabel?: string;
  /** True while the request is in flight. */
  pending: boolean;
  /** Fires the action once a reason is chosen: (category, comment). */
  onConfirm: (category: string, comment: string) => void;
  /** Close without acting. */
  onClose: () => void;
}

/**
 * The feedback gate on pausing a plan: one screen, and the confirm button stays
 * disabled until a category is picked. The reason is recorded (billing_feedback)
 * before the Stripe call runs.
 *
 * Deliberately the *lightest* of the three gates, because pausing is the fully
 * reversible action — the one we'd rather a wavering family took. Cancelling
 * (CancelPlanDialog) and dropping a subject (RemoveSubjectDialog) each carry
 * more friction in proportion to what they take away.
 */
export function PlanFeedbackDialog({
  planName,
  ownerLabel,
  endsAtLabel,
  pending,
  onConfirm,
  onClose,
}: PlanFeedbackDialogProps) {
  const [category, setCategory] = useState("");
  const [comment, setComment] = useState("");
  const whose = ownerLabel ? `${ownerLabel}'s` : "your";

  const copy = {
    title: "Pause this plan",
    icon: <PauseCircle className="w-5 h-5 text-amber-600" />,
    iconBg: "bg-amber-100",
    body: `Payments stop immediately and ${whose} access is suspended until you resume — nothing is lost, and progress and history are kept.${
      endsAtLabel ? ` This period was due to renew ${endsAtLabel}.` : ""
    } Before you pause, please tell us why.`,
    confirm: "Pause plan",
    confirmClass: "bg-amber-600",
    keep: "Keep plan",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary-deep/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-feedback-title"
    >
      <div className="w-full max-w-lg rounded-2xl premium-card shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl ${copy.iconBg} flex items-center justify-center shrink-0`}
            >
              {copy.icon}
            </div>
            <div>
              <h2 id="plan-feedback-title" className="font-display text-lg font-bold leading-tight">
                {copy.title}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">{planName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 text-sm">
          <p className="text-muted-foreground">{copy.body}</p>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Reason <span className="text-rose-600">*</span>
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-border bg-background p-2.5 text-sm"
            >
              <option value="">Choose a reason…</option>
              {BILLING_FEEDBACK_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Anything else? (optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="Tell us more — it helps us improve."
              className="w-full rounded-lg border border-border bg-background p-2.5 text-sm resize-none"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={pending}
              className="h-10 px-4 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              {copy.keep}
            </button>
            <button
              onClick={() => onConfirm(category, comment)}
              disabled={!category || pending}
              className={`flex-1 h-10 px-4 rounded-lg ${copy.confirmClass} text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2`}
            >
              {pending && <Loader2 className="w-4 h-4 animate-spin" />}
              {copy.confirm}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
