import { useState } from "react";
import { MinusCircle, PauseCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { SectionHeading } from "@/components/Shared";
import {
  formatPence,
  isPlanChangeable,
  isSubscriptionLive,
  type SubscriptionRow,
} from "@/lib/billing/billing";
import { useManageSubscription, usePackages, useRemoveSubjects } from "@/hooks/data/useBilling";
import { CADENCES, planCadence, tierFor } from "@/lib/billing/entitlements";
import { RemoveSubjectDialog } from "@/components/billing/RemoveSubjectDialog";
import { PlanFeedbackDialog } from "@/components/billing/PlanFeedbackDialog";
import { CancelPlanDialog } from "@/components/billing/CancelPlanDialog";
import { recordBillingFeedback } from "@/lib/billing/billingFeedback";
import type { CourseSummary } from "@/lib/curriculum/courseSummary";

interface PlanLifecycleActionsProps {
  sub: SubscriptionRow;
  planName: string;
  /** Same rule as SubscriptionPanel's canManage: the payer or a linked parent. */
  canManage: boolean;
  /** Whose plan it is (e.g. a child's name), for the dialogs' copy. */
  ownerLabel?: string;
  /** The plan's subjects — what can be dropped, and what the cancel dialog names. */
  course?: CourseSummary;
  /** Exam level, so the smaller plan's price comes off the right ladder. */
  level?: string | null;
}

/**
 * Drop a subject, pause, cancel — every way to pay less, kept at the very
 * bottom of the page, under everything else the family might want to do first.
 *
 * All three are gated: dropping by a choice of subject then
 * RemoveSubjectDialog (refused on the last subject — a plan covering nothing is
 * a cancellation), pausing by a one-screen reason form, cancelling by the
 * four-step CancelPlanDialog (which offers pausing or dropping a subject
 * instead). Renders nothing when none applies. Authority is enforced
 * server-side too — hiding the buttons is UX, not security.
 */
export function PlanLifecycleActions({
  sub,
  planName,
  canManage,
  ownerLabel,
  course,
  level,
}: PlanLifecycleActionsProps) {
  const manage = useManageSubscription();
  const remove = useRemoveSubjects();
  const { data: packages = [] } = usePackages(level);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  /** The subject chooser under the buttons, then the subject being dropped. */
  const [choosing, setChoosing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const live = isSubscriptionLive(sub.status);
  const paused = sub.status === "paused";
  const endsAtLabel = sub.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : undefined;
  // A row without a Stripe subscription has nothing to pause or cancel.
  const manageable = canManage && !!sub.stripe_subscription_id;
  const canPause = live && !sub.cancel_at_period_end;
  const canCancel = (live || paused) && !sub.cancel_at_period_end;
  const changeable = isPlanChangeable(sub);
  const perSubject = course?.perSubject ?? [];
  const subjectLabels = perSubject.map((s) => s.subjectLabel);
  const labelOf = (subject: string) =>
    perSubject.find((s) => s.subject === subject)?.subjectLabel ?? subject;
  // Subjects only come off a live plan that isn't ending, and never the last.
  const canDrop = changeable && perSubject.length > 1;

  // What the plan costs once a subject comes off — the ladder one step down.
  const cadence = planCadence(sub.plan);
  const nextPkg = cadence
    ? packages.find((p) => p.tier === tierFor(cadence, perSubject.length - 1))
    : undefined;
  const unit = CADENCES.find((c) => c.key === cadence)?.unit;

  const confirmRemove = (category: string, comment: string) => {
    if (!removing) return;
    remove.mutate(
      { studentId: sub.student_id, subjects: [removing] },
      {
        onSuccess: (res) => {
          // Only once the removal has worked: a refused one must not leave an
          // entry in the tutor's plan history.
          void recordBillingFeedback({
            studentId: sub.student_id,
            action: "remove_subject",
            category,
            comment,
          });
          const label = labelOf(removing);
          setRemoving(null);
          setChoosing(false);
          toast.success(`${label} removed. Your next bill drops to the smaller plan.`, {
            description: `Still covered: ${res.remaining.map(labelOf).join(", ")}.`,
          });
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  // Run it, then record why the family paused/cancelled (manager-only, enforced
  // by RLS). Only once it has worked: a refused or failed action must not leave
  // an entry in the tutor's plan history. Best-effort: a lost row never matters.
  const confirmWith = (action: "pause" | "cancel") => (category: string, comment: string) => {
    manage.mutate(
      { action, studentId: sub.student_id },
      {
        onSuccess: () => {
          void recordBillingFeedback({ studentId: sub.student_id, action, category, comment });
          setPauseOpen(false);
          setCancelOpen(false);
          toast.success(
            action === "cancel"
              ? `Plan will end ${endsAtLabel ?? "at the end of the period"} — no further charges.`
              : "Plan paused. No payments will be taken until you resume.",
          );
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  if (!manageable || !(canDrop || canPause || canCancel)) return null;

  const busy = manage.isPending || remove.isPending;

  return (
    <section className="pop-card pop-card-flat p-4 sm:p-5">
      <SectionHeading title="Need a change?">
        {canDrop && (
          <button
            type="button"
            onClick={() => setChoosing((v) => !v)}
            aria-expanded={choosing}
            disabled={busy}
            className="btn-soft tint-slate inline-flex h-11 items-center gap-1.5 rounded-lg px-3.5 text-sm sm:pointer-fine:h-9"
          >
            <MinusCircle className="size-4" aria-hidden /> Drop a subject
          </button>
        )}
        {canPause && (
          <button
            type="button"
            onClick={() => setPauseOpen(true)}
            disabled={busy}
            className="btn-soft tint-slate inline-flex h-11 items-center gap-1.5 rounded-lg px-3.5 text-sm sm:pointer-fine:h-9"
          >
            <PauseCircle className="size-4" aria-hidden /> Pause plan
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            onClick={() => setCancelOpen(true)}
            disabled={busy}
            className="btn-soft tint-rose inline-flex h-11 items-center gap-1.5 rounded-lg px-3.5 text-sm sm:pointer-fine:h-9"
          >
            <XCircle className="size-4" aria-hidden /> Cancel plan
          </button>
        )}
      </SectionHeading>

      {choosing && canDrop && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">Which subject?</p>
          {perSubject.map((s) => (
            <button
              key={s.subject}
              type="button"
              onClick={() => setRemoving(s.subject)}
              disabled={busy}
              className="btn-soft tint-rose inline-flex h-11 items-center rounded-lg px-3.5 text-sm sm:pointer-fine:h-9"
            >
              Drop {s.subjectLabel}
            </button>
          ))}
        </div>
      )}

      {removing && (
        <RemoveSubjectDialog
          subjectLabel={labelOf(removing)}
          remainingLabels={perSubject
            .filter((s) => s.subject !== removing)
            .map((s) => s.subjectLabel)}
          newPlanName={nextPkg?.name}
          newPriceLabel={nextPkg ? formatPence(nextPkg.price_pence) : undefined}
          unitLabel={unit}
          ownerLabel={ownerLabel}
          pending={remove.isPending}
          onConfirm={confirmRemove}
          onClose={() => setRemoving(null)}
        />
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
          canRemoveInstead={canDrop}
          onPauseInstead={() => {
            setCancelOpen(false);
            setPauseOpen(true);
          }}
          onRemoveInstead={() => {
            setCancelOpen(false);
            setChoosing(true);
          }}
          onConfirm={confirmWith("cancel")}
          onClose={() => setCancelOpen(false)}
        />
      )}
    </section>
  );
}
