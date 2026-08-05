import { ArrowRight, Check, Info, Loader2, Replace, X } from "lucide-react";

interface SwitchBoardDialogProps {
  /** Subject being moved ("Biology"). */
  subjectLabel: string;
  /** Board it sits with today ("Edexcel"). */
  fromLabel: string;
  /** Board it is moving to ("OCR"). */
  toLabel: string;
  /** The student's level ("GCSE"), so the new spec is named in full. */
  levelLabel?: string | null;
  /** True while the enrolment write is in flight. */
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The one gate on switching a subject's exam board.
 *
 * Far lighter than the billing dialogs — no reason field, no typed confirmation
 * — because nothing is bought, sold or lost here, and the first line says so.
 * It exists only because the board silently re-scopes every page on the account,
 * and a student who mis-clicks a chip should find that out before their whole
 * curriculum changes shape rather than after.
 */
export function SwitchBoardDialog({
  subjectLabel,
  fromLabel,
  toLabel,
  levelLabel,
  pending,
  onConfirm,
  onClose,
}: SwitchBoardDialogProps) {
  const spec = levelLabel ? `${levelLabel} ${toLabel}` : toLabel;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary-deep/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="switch-board-title"
    >
      <div className="w-full max-w-lg rounded-2xl premium-card shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <Replace className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 id="switch-board-title" className="font-display text-lg font-bold leading-tight">
                Move {subjectLabel} to {toLabel}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                {fromLabel} <ArrowRight className="w-3 h-3" /> {toLabel} — your price stays the same
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
              <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                <strong>Nothing changes about your bill.</strong> Every board is included in every
                plan — you're charged for how many subjects you study, not which spec you sit.
              </span>
            </li>
            <li className="flex gap-2.5">
              <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span>
                {subjectLabel} lessons, videos, quizzes and homework switch to the{" "}
                <strong>{spec}</strong> specification straight away.
              </span>
            </li>
            <li className="flex gap-2.5">
              <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span>
                Your weekly focus and revision plan rebuild around the new spec points, so this
                week's plan will look different.
              </span>
            </li>
            <li className="flex gap-2.5">
              <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                Confidence and marks you've recorded against the {fromLabel} spec points are{" "}
                <strong>kept</strong> — move back and they're still there.
              </span>
            </li>
          </ul>

          <p className="text-xs text-muted-foreground rounded-xl border border-border bg-muted/40 p-3">
            Not sure which board you're on? It's printed on the front of your exam papers, and your
            other subjects can stay where they are — boards are set per subject.
          </p>

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={pending}
              className="flex-1 h-10 px-4 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              Stay on {fromLabel}
            </button>
            <button
              onClick={onConfirm}
              disabled={pending}
              className="h-10 px-4 rounded-lg btn-solid text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {pending && <Loader2 className="w-4 h-4 animate-spin" />}
              Switch to {toLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
