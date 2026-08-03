import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  MinusCircle,
  PauseCircle,
  X,
  XCircle,
} from "lucide-react";
import { BILLING_FEEDBACK_REASONS } from "@/lib/billingFeedback";

/** The exact word the user has to type before the cancel button unlocks. */
const CONFIRM_WORD = "CANCEL";

interface CancelPlanDialogProps {
  /** Human plan name, shown throughout so they know what they're ending. */
  planName: string;
  /** Whose plan it is ("Alex's plan") for the parent view. Omit for own plan. */
  ownerLabel?: string;
  /** Formatted period-end date — the day access actually stops. */
  endsAtLabel?: string;
  /** Subjects the plan currently covers, for the "you'll lose" list. */
  subjectLabels: string[];
  /** True while the Stripe call is in flight. */
  pending: boolean;
  /** Offer "pause instead" — only when the plan is actually pausable. */
  canPauseInstead: boolean;
  /** Offer "drop a subject instead" — only when more than one is covered. */
  canRemoveInstead: boolean;
  /** Close this dialog and open the pause flow. */
  onPauseInstead: () => void;
  /** Close this dialog and scroll them to the subject list. */
  onRemoveInstead: () => void;
  /** Fires the cancellation once every gate is passed: (category, comment). */
  onConfirm: (category: string, comment: string) => void;
  /** Close without acting. */
  onClose: () => void;
}

type Step = "consequences" | "alternatives" | "reason" | "confirm";

const STEPS: Step[] = ["consequences", "alternatives", "reason", "confirm"];

/**
 * The deliberately sticky cancel flow.
 *
 * Cancelling is the one irreversible-feeling action on the billing page, so it
 * is four screens rather than a button: what actually happens (with the real
 * date) → the cheaper things they could do instead → why they're leaving →
 * typing the word CANCEL. Each screen can be backed out of, and "Keep my plan"
 * is the visually dominant choice on every one of them.
 *
 * The friction is honest rather than obstructive: nothing here hides the exit,
 * and no step can be satisfied by clicking through — the reason is required and
 * the confirmation is typed. Pausing, by contrast, stays a single small form
 * (PlanFeedbackDialog), because pausing is reversible.
 *
 * The alternatives step is the point of the whole flow: most families who reach
 * here want a smaller bill, not none, and dropping one subject is usually what
 * they actually meant.
 */
export function CancelPlanDialog({
  planName,
  ownerLabel,
  endsAtLabel,
  subjectLabels,
  pending,
  canPauseInstead,
  canRemoveInstead,
  onPauseInstead,
  onRemoveInstead,
  onConfirm,
  onClose,
}: CancelPlanDialogProps) {
  const [step, setStep] = useState<Step>("consequences");
  const [category, setCategory] = useState("");
  const [comment, setComment] = useState("");
  const [typed, setTyped] = useState("");

  const whose = ownerLabel ? `${ownerLabel}'s` : "your";
  const Whose = `${whose[0].toUpperCase()}${whose.slice(1)}`;
  const endsAt = endsAtLabel ?? "the end of the current billing period";
  const stepIndex = STEPS.indexOf(step);

  const back = () => setStep(STEPS[Math.max(stepIndex - 1, 0)]);
  const next = () => setStep(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary-deep/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-plan-title"
    >
      <div className="w-full max-w-lg rounded-2xl premium-card shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
              <XCircle className="w-5 h-5 text-rose-600" />
            </div>
            <div>
              <h2 id="cancel-plan-title" className="font-display text-lg font-bold leading-tight">
                Cancel this plan
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {planName} · step {stepIndex + 1} of {STEPS.length}
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

        {/* Progress rail — makes the length of the flow visible up front rather
            than springing another screen on them each time they click. */}
        <div className="flex gap-1 px-6 pt-4">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full ${i <= stepIndex ? "bg-rose-500" : "bg-border"}`}
            />
          ))}
        </div>

        <div className="p-6 space-y-4 text-sm">
          {step === "consequences" && (
            <>
              <p className="text-muted-foreground">
                Here's exactly what cancelling does. Nothing happens until the last step.
              </p>
              <ul className="space-y-2.5">
                <li className="flex gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    {Whose} access stays on until <strong>{endsAt}</strong> — you keep everything
                    you've already paid for.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    No further charges. You can resume any time before that date and nothing
                    changes.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    Progress, marks and revision history are <strong>kept</strong>, not deleted.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>
                    After that date {whose} lessons, quizzes, homework marking and revision planner
                    lock
                    {subjectLabels.length ? ` for ${subjectLabels.join(" and ")}` : ""}.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>
                    The current period isn't refunded, and restarting later means checking out at
                    whatever the price is then.
                  </span>
                </li>
              </ul>
            </>
          )}

          {step === "alternatives" && (
            <>
              <p className="text-muted-foreground">
                Most families who get this far want a smaller bill rather than no plan. These take
                effect straight away:
              </p>
              <div className="space-y-2">
                {canPauseInstead && (
                  <button
                    onClick={onPauseInstead}
                    className="w-full text-left rounded-xl border border-border p-4 hover:border-primary hover:bg-primary/5 transition"
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <PauseCircle className="w-4 h-4 text-amber-600" /> Pause instead
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Payments stop immediately and everything is held exactly where it is. Resume
                      whenever you're ready — best for exam breaks and holidays.
                    </p>
                  </button>
                )}
                {canRemoveInstead && (
                  <button
                    onClick={onRemoveInstead}
                    className="w-full text-left rounded-xl border border-border p-4 hover:border-primary hover:bg-primary/5 transition"
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <MinusCircle className="w-4 h-4 text-primary" /> Drop a subject instead
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Keep the subjects that matter and pay less. Your bill drops to the smaller
                      plan and the unused part of this period is credited.
                    </p>
                  </button>
                )}
                <div className="rounded-xl border border-border p-4">
                  <div className="font-semibold">Something we could fix?</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    If it's a tutor, a subject or a timetable problem, tell us on the next step — we
                    read every one of these.
                  </p>
                </div>
              </div>
            </>
          )}

          {step === "reason" && (
            <>
              <p className="text-muted-foreground">
                Before you cancel, please tell us why. This is the only part we ask of you.
              </p>
              <div>
                <label
                  htmlFor="cancel-reason"
                  className="block text-xs font-semibold text-muted-foreground mb-1"
                >
                  Reason <span className="text-rose-600">*</span>
                </label>
                <select
                  id="cancel-reason"
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
                  htmlFor="cancel-comment"
                  className="block text-xs font-semibold text-muted-foreground mb-1"
                >
                  Anything else? (optional)
                </label>
                <textarea
                  id="cancel-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  placeholder="Tell us more — it helps us improve."
                  className="w-full rounded-lg border border-border bg-background p-2.5 text-sm resize-none"
                />
              </div>
            </>
          )}

          {step === "confirm" && (
            <>
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                <p className="font-semibold text-rose-900">
                  {planName} will end on {endsAt}.
                </p>
                <p className="text-xs text-rose-800 mt-1">
                  This is the last step — the next click sends it to Stripe.
                </p>
              </div>
              <div>
                <label
                  htmlFor="cancel-confirm-word"
                  className="block text-xs font-semibold text-muted-foreground mb-1"
                >
                  Type <span className="font-mono font-bold text-foreground">{CONFIRM_WORD}</span>{" "}
                  to confirm
                </label>
                <input
                  id="cancel-confirm-word"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  placeholder={CONFIRM_WORD}
                  className="w-full rounded-lg border border-border bg-background p-2.5 text-sm font-mono tracking-widest"
                />
              </div>
            </>
          )}

          <div className="flex gap-2 pt-1">
            {stepIndex > 0 && (
              <button
                onClick={back}
                disabled={pending}
                className="h-10 px-3 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            )}
            <button
              onClick={onClose}
              disabled={pending}
              className="flex-1 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              Keep my plan
            </button>
            {step === "confirm" ? (
              <button
                onClick={() => onConfirm(category, comment)}
                disabled={typed.trim().toUpperCase() !== CONFIRM_WORD || pending}
                className="h-10 px-4 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {pending && <Loader2 className="w-4 h-4 animate-spin" />}
                Cancel plan
              </button>
            ) : (
              <button
                onClick={next}
                disabled={step === "reason" && !category}
                className="h-10 px-4 rounded-lg border border-rose-200 text-rose-600 text-sm font-semibold hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
