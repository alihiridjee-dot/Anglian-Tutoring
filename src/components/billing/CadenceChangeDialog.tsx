import { CalendarClock, Loader2, X } from "lucide-react";
import { useCadenceQuote } from "@/hooks/data/useBilling";
import { formatPence } from "@/lib/billing";

interface CadenceChangeDialogProps {
  studentId: string;
  /** Cadence key being moved to ("monthly"). */
  cadence: string;
  /** Its display label ("Monthly"). */
  cadenceLabel: string;
  /** Subjects covered — stated so it's clear the switch doesn't change them. */
  subjectCount: number;
  /** Whose plan it is ("Alex"), for the parent view. */
  ownerLabel?: string;
  /** True while the change itself is in flight. */
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirmation for a cadence switch, quoting Stripe's real number.
 *
 * The figure comes from an upcoming-invoice preview against the actual
 * subscription, not from subtracting two list prices: part-way through a
 * period, with credit for unused time, those are not the same and only Stripe
 * knows which. If the preview can't be fetched the dialog says so honestly
 * rather than showing an invented amount.
 *
 * Light friction on purpose — this changes when you pay, not what you get, and
 * it's reversible by switching back.
 */
export function CadenceChangeDialog({
  studentId,
  cadence,
  cadenceLabel,
  subjectCount,
  ownerLabel,
  pending,
  onConfirm,
  onClose,
}: CadenceChangeDialogProps) {
  const { data: quote, isLoading, isError } = useCadenceQuote(studentId, cadence);
  const whose = ownerLabel ? `${ownerLabel}'s` : "your";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary-deep/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cadence-change-title"
    >
      <div className="w-full max-w-md rounded-2xl premium-card shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <CalendarClock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2
                id="cadence-change-title"
                className="font-display text-lg font-bold leading-tight"
              >
                Switch to {cadenceLabel}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {quote?.plan_name ??
                  `${subjectCount === 1 ? "1 subject" : `${subjectCount} subjects`}`}
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
          <div className="rounded-xl border border-border bg-muted/40 p-4">
            <div className="text-xs text-muted-foreground">Due today</div>
            {isLoading ? (
              <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Asking Stripe…
              </div>
            ) : quote?.amount_due_now != null ? (
              <>
                <div className="font-display text-2xl font-bold text-primary">
                  {formatPence(quote.amount_due_now, quote.currency)}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Prorated by Stripe — the unused part of {whose} current period is credited against
                  this.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground mt-1">
                {isError
                  ? "Couldn't fetch the exact amount just now."
                  : "Stripe will prorate this at checkout."}{" "}
                You'll be charged the difference only, with credit for unused time.
              </p>
            )}
          </div>

          <p className="text-muted-foreground">
            {subjectCount === 1
              ? "The subject stays exactly as it is"
              : `All ${subjectCount} subjects stay exactly as they are`}{" "}
            — this only changes how often {ownerLabel ? "they're" : "you're"} billed. You can switch
            back at any time.
          </p>

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={pending}
              className="h-10 px-4 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={pending || isLoading}
              className="flex-1 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {pending && <Loader2 className="w-4 h-4 animate-spin" />}
              Switch to {cadenceLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
