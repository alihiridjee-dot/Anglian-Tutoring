import { useState } from "react";
import { AlertTriangle, Check, Loader2, MinusCircle, X } from "lucide-react";
import { BILLING_FEEDBACK_REASONS } from "@/lib/billingFeedback";

interface RemoveSubjectDialogProps {
  /** Display name of the subject being dropped ("Chemistry"). */
  subjectLabel: string;
  /** Subjects that stay on the plan afterwards, for reassurance. */
  remainingLabels: string[];
  /** Human name of the plan they'll move down to, if resolvable. */
  newPlanName?: string;
  /** Formatted new recurring price ("£59.99"), if resolvable. */
  newPriceLabel?: string;
  /** "per month" / "per week" — the cadence the new price is charged at. */
  unitLabel?: string;
  /** Whose plan it is ("Alex's"), for the parent view. Omit for own plan. */
  ownerLabel?: string;
  /** True while the Stripe call is in flight. */
  pending: boolean;
  /** Fires the removal once the gates pass: (category, comment). */
  onConfirm: (category: string, comment: string) => void;
  onClose: () => void;
}

/**
 * The gate on dropping one subject from a plan.
 *
 * Lighter than CancelPlanDialog — this is a downgrade, not an exit, and the
 * family keeps a live plan either way — but still deliberately sticky: it takes
 * a reason and the typed subject name, because removal revokes access
 * immediately rather than at the period boundary, and re-adding later is a
 * fresh prorated charge.
 *
 * Typing the subject name (rather than a generic word) is doing real work here:
 * on a three-subject plan it is the thing that stops someone dropping Physics
 * when they meant Chemistry.
 */
export function RemoveSubjectDialog({
  subjectLabel,
  remainingLabels,
  newPlanName,
  newPriceLabel,
  unitLabel,
  ownerLabel,
  pending,
  onConfirm,
  onClose,
}: RemoveSubjectDialogProps) {
  const [category, setCategory] = useState("");
  const [comment, setComment] = useState("");
  const [typed, setTyped] = useState("");

  const whose = ownerLabel ? `${ownerLabel}'s` : "your";
  const Whose = `${whose[0].toUpperCase()}${whose.slice(1)}`;
  const matches = typed.trim().toLowerCase() === subjectLabel.toLowerCase();

  // "Biology carries on" but "Biology and Physics carry on" — the list is 1-2
  // items here (a plan covers at most three subjects), so a plain agreement
  // check is enough and reads better than a generic "the rest of the plan".
  const remainingCarryOn = remainingLabels.length
    ? `${remainingLabels.join(" and ")} ${remainingLabels.length === 1 ? "carries" : "carry"} on exactly as now.`
    : "The rest of the plan carries on exactly as now.";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary-deep/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-subject-title"
    >
      <div className="w-full max-w-lg rounded-2xl premium-card shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
              <MinusCircle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2
                id="remove-subject-title"
                className="font-display text-lg font-bold leading-tight"
              >
                Remove {subjectLabel}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {Whose} plan stays active — it just gets smaller
              </p>
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
          <ul className="space-y-2.5">
            <li className="flex gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                {subjectLabel} lessons, quizzes, homework and revision planner lock{" "}
                <strong>straight away</strong> — not at the end of the period.
              </span>
            </li>
            <li className="flex gap-2.5">
              <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{remainingCarryOn}</span>
            </li>
            <li className="flex gap-2.5">
              <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                {subjectLabel} progress and marks are <strong>kept</strong> — add it back later and
                it's all still there.
              </span>
            </li>
            <li className="flex gap-2.5">
              <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                The unused part of this period becomes a <strong>credit</strong> against your next
                bill. Nothing is charged today.
              </span>
            </li>
          </ul>

          {newPriceLabel && (
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <div className="text-xs text-muted-foreground">Your plan from the next bill</div>
              <div className="font-display text-2xl font-bold text-primary">
                {newPriceLabel}
                {unitLabel && (
                  <span className="text-sm font-medium text-muted-foreground"> {unitLabel}</span>
                )}
              </div>
              {newPlanName && (
                <div className="text-xs text-muted-foreground mt-0.5">{newPlanName}</div>
              )}
            </div>
          )}

          <div>
            <label
              htmlFor="remove-reason"
              className="block text-xs font-semibold text-muted-foreground mb-1"
            >
              Why are you dropping it? <span className="text-rose-600">*</span>
            </label>
            <select
              id="remove-reason"
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
            <label
              htmlFor="remove-comment"
              className="block text-xs font-semibold text-muted-foreground mb-1"
            >
              Anything else? (optional)
            </label>
            <textarea
              id="remove-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="Tell us more — it helps us improve."
              className="w-full rounded-lg border border-border bg-background p-2.5 text-sm resize-none"
            />
          </div>

          <div>
            <label
              htmlFor="remove-confirm-word"
              className="block text-xs font-semibold text-muted-foreground mb-1"
            >
              Type <span className="font-mono font-bold text-foreground">{subjectLabel}</span> to
              confirm
            </label>
            <input
              id="remove-confirm-word"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              placeholder={subjectLabel}
              className="w-full rounded-lg border border-border bg-background p-2.5 text-sm"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={pending}
              className="flex-1 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              Keep {subjectLabel}
            </button>
            <button
              onClick={() => onConfirm(category, comment)}
              disabled={!category || !matches || pending}
              className="h-10 px-4 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              {pending && <Loader2 className="w-4 h-4 animate-spin" />}
              Remove {subjectLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
