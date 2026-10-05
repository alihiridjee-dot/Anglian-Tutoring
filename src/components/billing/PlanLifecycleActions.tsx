import { useState } from "react";
import { PauseCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { SectionHeading } from "@/components/Shared";
import { isPlanChangeable, isSubscriptionLive, type SubscriptionRow } from "@/lib/billing/billing";
import { useManageSubscription } from "@/hooks/data/useBilling";
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
  /** The plan's subjects, for the cancel dialog's "drop one instead" offer. */
  course?: CourseSummary;
  /** DOM id of the matching EnrolledSubjectsCard, for "drop a subject instead". */
  subjectsAnchorId?: string;
}

/**
 * Pause and cancel — the two ways to stop paying, kept at the very bottom of
 * the page, under everything else the family might want to do first.
 *
 * Both are gated: pausing by a one-screen reason form, cancelling by the
 * four-step CancelPlanDialog (which offers pausing or dropping a subject
 * instead). Renders nothing when neither applies. Authority is enforced
 * server-side too — hiding the buttons is UX, not security.
 */
export function PlanLifecycleActions({
  sub,
  planName,
  canManage,
  ownerLabel,
  course,
  subjectsAnchorId = "subjects",
}: PlanLifecycleActionsProps) {
  const manage = useManageSubscription();
  const [pauseOpen, setPauseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

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
  const subjectLabels = course?.perSubject.map((s) => s.subjectLabel) ?? [];

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

  // "Drop a subject instead" hands them to EnrolledSubjectsCard, which owns the
  // removal flow.
  const goToSubjects = () => {
    setCancelOpen(false);
    document
      .getElementById(subjectsAnchorId)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!manageable || !(canPause || canCancel)) return null;

  return (
    <section className="premium-card rounded-2xl p-4 sm:p-6">
      <SectionHeading title="Pause or cancel">
        {canPause && (
          <button
            type="button"
            onClick={() => setPauseOpen(true)}
            disabled={manage.isPending}
            className="btn-soft tint-slate inline-flex h-11 items-center gap-1.5 rounded-lg px-3.5 text-sm sm:pointer-fine:h-9"
          >
            <PauseCircle className="size-4" aria-hidden /> Pause plan
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            onClick={() => setCancelOpen(true)}
            disabled={manage.isPending}
            className="btn-soft tint-rose inline-flex h-11 items-center gap-1.5 rounded-lg px-3.5 text-sm sm:pointer-fine:h-9"
          >
            <XCircle className="size-4" aria-hidden /> Cancel plan
          </button>
        )}
      </SectionHeading>

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
          canRemoveInstead={changeable && subjectLabels.length > 1}
          onPauseInstead={() => {
            setCancelOpen(false);
            setPauseOpen(true);
          }}
          onRemoveInstead={goToSubjects}
          onConfirm={confirmWith("cancel")}
          onClose={() => setCancelOpen(false)}
        />
      )}
    </section>
  );
}
