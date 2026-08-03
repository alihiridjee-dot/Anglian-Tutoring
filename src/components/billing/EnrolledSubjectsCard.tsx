import { useState } from "react";
import { BookOpen, Loader2, MinusCircle } from "lucide-react";
import { toast } from "sonner";
import { SUBJECTS, BOARDS } from "@/lib/taxonomy";
import { usePackages, useRemoveSubjects } from "@/hooks/data/useBilling";
import { formatPence } from "@/lib/billing";
import { planCadence, tierFor, CADENCES } from "@/lib/entitlements";
import { RemoveSubjectDialog } from "@/components/billing/RemoveSubjectDialog";
import { recordBillingFeedback } from "@/lib/billingFeedback";

interface EnrolledSubjectsCardProps {
  /** subscriptions.student_id whose plan these subjects sit on. */
  studentId: string;
  /** The plan's current tier, e.g. "monthly_2" — sets the price ladder. */
  currentTier: string;
  /** What the plan covers today, with the board each is sat with. */
  enrolments: { subject: string; board: string }[];
  /** Exam level, so the price shown is off the right ladder. */
  level?: string | null;
  /** Whether the viewer may shrink the plan (payer or linked parent). */
  canManage: boolean;
  /** Whose plan it is ("Alex"), for the parent view. Omit for own plan. */
  ownerLabel?: string;
  /**
   * DOM id the cancel dialog's "drop a subject instead" scrolls to. Defaults to
   * "subjects"; the parent tab renders one card per child, so it passes a
   * per-child id to keep them unique.
   */
  anchorId?: string;
}

const subjectLabel = (value: string) =>
  SUBJECTS.find((s) => s.value === value)?.label ?? value.charAt(0).toUpperCase() + value.slice(1);

const boardLabel = (value: string) => BOARDS.find((b) => b.value === value)?.label ?? value;

/**
 * What the plan actually covers, and the only place a single subject can be
 * dropped without ending the whole plan.
 *
 * This is the missing half of AddSubjectCard: the page could grow a plan but
 * never shrink one, so "I want to stop Chemistry" had no answer short of
 * cancelling everything. Removal is gated by RemoveSubjectDialog and refused
 * outright on the last subject — a plan covering nothing is a cancellation, and
 * that has its own flow.
 *
 * Read-only (no Remove buttons) for a student on a plan someone else pays for;
 * they still see exactly what they're enrolled in and who to ask.
 */
export function EnrolledSubjectsCard({
  studentId,
  currentTier,
  enrolments,
  level,
  canManage,
  ownerLabel,
  anchorId = "subjects",
}: EnrolledSubjectsCardProps) {
  const { data: packages = [] } = usePackages(level);
  const remove = useRemoveSubjects();
  const [removing, setRemoving] = useState<string | null>(null);

  const cadence = planCadence(currentTier);
  const isLast = enrolments.length <= 1;
  const whose = ownerLabel ? `${ownerLabel}'s` : "your";

  // What the plan costs once this subject comes off — the ladder one step down.
  const nextPkg =
    cadence && !isLast
      ? packages.find((p) => p.tier === tierFor(cadence, enrolments.length - 1))
      : undefined;
  const unit = CADENCES.find((c) => c.key === cadence)?.unit;

  const confirmRemove = (category: string, comment: string) => {
    if (!removing) return;
    void recordBillingFeedback({
      studentId,
      action: "remove_subject",
      category,
      comment,
    });
    remove.mutate(
      { studentId, subjects: [removing] },
      {
        onSuccess: (res) => {
          const label = subjectLabel(removing);
          setRemoving(null);
          toast.success(`${label} removed. Your next bill drops to the smaller plan.`, {
            description: `Still covered: ${res.remaining.map(subjectLabel).join(", ")}.`,
          });
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div id={anchorId} className="rounded-2xl premium-card p-6 scroll-mt-24">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
          <BookOpen className="w-4 h-4 text-primary" />
        </div>
        <h3 className="font-display text-lg font-semibold">Subjects on this plan</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        {canManage
          ? "Everything the plan pays for. Remove one and the bill drops to the smaller plan from your next bill."
          : `Everything ${whose} plan pays for.`}
      </p>

      <div className="mt-4 space-y-2">
        {enrolments.length === 0 && (
          <p className="text-sm text-muted-foreground">No subjects on this plan yet.</p>
        )}
        {enrolments.map((e) => (
          <div
            key={e.subject}
            className="flex items-center justify-between gap-3 rounded-xl border border-border p-3.5"
          >
            <div className="min-w-0">
              <div className="font-semibold text-sm">{subjectLabel(e.subject)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {boardLabel(e.board)} · included in your plan
              </div>
            </div>
            {canManage && !isLast && (
              <button
                onClick={() => setRemoving(e.subject)}
                disabled={remove.isPending}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-rose-200 text-rose-600 text-sm font-semibold hover:bg-rose-50 disabled:opacity-50 shrink-0"
              >
                {remove.isPending && removing === e.subject ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <MinusCircle className="w-4 h-4" />
                )}
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      {canManage && isLast && enrolments.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground rounded-xl border border-border bg-muted/40 p-3">
          This is the last subject on the plan, so it can't be removed on its own — a plan covering
          nothing is a cancelled plan. Use <strong>Cancel plan</strong> below to stop billing
          entirely, or <strong>Pause</strong> if you're coming back.
        </p>
      )}

      {removing && (
        <RemoveSubjectDialog
          subjectLabel={subjectLabel(removing)}
          remainingLabels={enrolments
            .filter((e) => e.subject !== removing)
            .map((e) => subjectLabel(e.subject))}
          newPlanName={nextPkg?.name}
          newPriceLabel={nextPkg ? formatPence(nextPkg.price_pence) : undefined}
          unitLabel={unit}
          ownerLabel={ownerLabel}
          pending={remove.isPending}
          onConfirm={confirmRemove}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
