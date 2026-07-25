import { useState } from "react";
import { Loader2, PauseCircle, X, XCircle } from "lucide-react";
import { BILLING_FEEDBACK_REASONS, type BillingFeedbackAction } from "@/lib/billingFeedback";

interface PlanFeedbackDialogProps {
  /** Which lifecycle action this gate fronts. Drives all the copy + styling. */
  action: BillingFeedbackAction;
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
 * The feedback gate on pausing OR cancelling a plan. Both are now deliberately
 * behind this small form — the confirm button stays disabled until a category
 * is picked, and the reason is recorded (billing_feedback) before the Stripe
 * call runs. This is the friction: there is no one-click cancel, and cancelling
 * is the only way to end a plan (deletion was removed).
 */
export function PlanFeedbackDialog({
  action,
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

  const isCancel = action === "cancel";
  const copy = isCancel
    ? {
        title: "Cancel this plan",
        icon: <XCircle className="w-5 h-5 text-rose-600" />,
        iconBg: "bg-rose-100",
        body: `${whose[0].toUpperCase()}${whose.slice(1)} plan will stay active until ${
          endsAtLabel ?? "the end of the current billing period"
        }, then stop — no further charges. You can resume any time before it ends. Before you cancel, please tell us why.`,
        confirm: "Cancel plan",
        confirmClass: "bg-rose-600",
        keep: "Keep plan",
      }
    : {
        title: "Pause this plan",
        icon: <PauseCircle className="w-5 h-5 text-amber-600" />,
        iconBg: "bg-amber-100",
        body: `Payments stop immediately and ${whose} access is suspended until you resume. Nothing is lost — progress and history are kept. Before you pause, please tell us why.`,
        confirm: "Pause plan",
        confirmClass: "bg-amber-600",
        keep: "Keep plan",
      };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-feedback-title"
    >
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-xl max-h-[90vh] overflow-y-auto">
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
