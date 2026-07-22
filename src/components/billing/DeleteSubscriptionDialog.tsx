import { useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { useDeleteSubscription } from "@/hooks/data/useBilling";
import { BILLING_FEEDBACK_REASONS, recordBillingFeedback } from "@/lib/billingFeedback";

interface DeleteSubscriptionDialogProps {
  /** subscriptions.student_id whose plan is being deleted. */
  studentId: string;
  /** Human plan name, shown throughout so the user knows what they're deleting. */
  planName: string;
  /** Whose plan it is, for the parent view ("Alex's plan"). Omit for own plan. */
  ownerLabel?: string;
  /** The EU-mandated easy path: cancel at period end instead of deleting. */
  onCancelInstead: () => void;
  /** Close without doing anything. */
  onClose: () => void;
}

const CONFIRM_PHRASE = "DELETE";

/**
 * The deliberate friction on subscription deletion.
 *
 * Cancellation stays one click away (EU/§312k easy-cancellation): this dialog's
 * first screen actively steers the user there. Deletion is the separate, heavier
 * GDPR Art. 17 erasure — so it is gated behind informed, unbundled consent:
 *
 *   1. Choose deletion over the recommended cancellation.
 *   2. Tick three specific acknowledgements (immediate loss, irreversibility,
 *      the statutory invoice-retention exemption) — no pre-ticked boxes.
 *   3. Type the confirmation phrase.
 *
 * Only when all three are satisfied does the final button enable. The server
 * enforces payer-ownership and the "must have a Stripe subscription" rule
 * independently — this component is the consent record, not the security.
 */
export function DeleteSubscriptionDialog({
  studentId,
  planName,
  ownerLabel,
  onCancelInstead,
  onClose,
}: DeleteSubscriptionDialogProps) {
  const del = useDeleteSubscription();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [ackImmediate, setAckImmediate] = useState(false);
  const [ackIrreversible, setAckIrreversible] = useState(false);
  const [ackRetention, setAckRetention] = useState(false);
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");

  const whose = ownerLabel ? `${ownerLabel}'s` : "your";
  const allAcknowledged = ackImmediate && ackIrreversible && ackRetention;
  // Step 2 also requires a feedback reason before continuing — deleting is gated
  // behind the same short form as pausing.
  const step2Ready = allAcknowledged && !!category;
  const phraseOk = phrase.trim() === CONFIRM_PHRASE;

  const confirmDelete = () => {
    if (!step2Ready || !phraseOk) return;
    void recordBillingFeedback({ studentId, action: "delete", category, comment: reason });
    del.mutate(
      { studentId, reason: reason.trim() || undefined },
      {
        onSuccess: () => {
          toast.success("Subscription deleted. Access has ended immediately.");
          onClose();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-sub-title"
    >
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5 text-rose-600" />
            </div>
            <div>
              <h2 id="delete-sub-title" className="font-display text-lg font-bold leading-tight">
                Delete subscription
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {planName} · Step {step} of 3
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
          {/* -------------------------------------------------- Step 1 */}
          {step === 1 && (
            <>
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-900">
                    You probably want to cancel, not delete.
                  </p>
                  <p className="text-amber-800 mt-1">
                    <span className="font-semibold">Cancelling</span> keeps access until the end of
                    the period you've already paid for, and you can undo it any time before then.
                    It's the quicker, reversible option.
                  </p>
                </div>
              </div>

              <p className="text-muted-foreground">
                <span className="font-semibold text-foreground">Deleting</span> is permanent and
                takes effect <span className="font-semibold text-foreground">immediately</span>: it
                ends {whose} access to lessons, quizzes and homework right away, with no refund for
                the remainder of the current billing period. It is intended for a full erasure
                request, not routine cancellation.
              </p>

              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <button
                  onClick={onCancelInstead}
                  className="flex-1 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
                >
                  Cancel at period end instead
                </button>
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 h-10 px-4 rounded-lg border border-rose-200 text-rose-600 text-sm font-semibold hover:bg-rose-50"
                >
                  Continue to deletion
                </button>
              </div>
            </>
          )}

          {/* -------------------------------------------------- Step 2 */}
          {step === 2 && (
            <>
              <p className="text-muted-foreground">
                Please confirm you understand what deleting {whose} <b>{planName}</b> subscription
                does. Each point must be acknowledged separately.
              </p>

              <label className="flex gap-3 items-start rounded-xl border border-border p-3 cursor-pointer hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={ackImmediate}
                  onChange={(e) => setAckImmediate(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-rose-600"
                />
                <span>
                  Access ends <b>immediately</b>, and there is <b>no refund</b> for the unused part
                  of the current billing period.
                </span>
              </label>

              <label className="flex gap-3 items-start rounded-xl border border-border p-3 cursor-pointer hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={ackIrreversible}
                  onChange={(e) => setAckIrreversible(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-rose-600"
                />
                <span>
                  This <b>cannot be undone</b>. Restoring access later means subscribing again from
                  scratch.
                </span>
              </label>

              <label className="flex gap-3 items-start rounded-xl border border-border p-3 cursor-pointer hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={ackRetention}
                  onChange={(e) => setAckRetention(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-rose-600"
                />
                <span>
                  Invoices and payment records are <b>kept for up to 6 years</b> to meet UK/EU tax
                  and accounting law. Under GDPR Article 17(3)(b) this legal obligation means they
                  are <b>not erased</b> by this deletion.
                </span>
              </label>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">
                  Reason for leaving <span className="text-rose-600">*</span>
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
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="Tell us more — it helps us improve."
                  className="w-full rounded-lg border border-border bg-background p-2.5 text-sm resize-none"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setStep(1)}
                  className="h-10 px-4 rounded-lg border border-border text-sm font-semibold hover:bg-muted"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!step2Ready}
                  className="flex-1 h-10 px-4 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              </div>
            </>
          )}

          {/* -------------------------------------------------- Step 3 */}
          {step === 3 && (
            <>
              <p className="text-muted-foreground">
                Final step. Type <b className="text-foreground">{CONFIRM_PHRASE}</b> below to
                permanently delete {whose} <b>{planName}</b> subscription.
              </p>

              <input
                type="text"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder={CONFIRM_PHRASE}
                className="w-full rounded-lg border border-border bg-background p-2.5 text-sm font-mono tracking-widest"
              />

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setStep(2)}
                  disabled={del.isPending}
                  className="h-10 px-4 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={!phraseOk || !step2Ready || del.isPending}
                  className="flex-1 h-10 px-4 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  {del.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Permanently delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
