import { EmptyState, SectionHeading, Spinner } from "@/components/Shared";
import { SubscriptionPanel } from "@/components/billing/SubscriptionPanel";
import { PlanLifecycleActions } from "@/components/billing/PlanLifecycleActions";
import { usePackages } from "@/hooks/data/useBilling";
import { useAccountDeletion } from "@/hooks/data/useStudents";
import { billingIntervalLabel, formatPence, planLabel } from "@/lib/billing/billing";
import { BILLING_FEEDBACK_REASONS } from "@/lib/billing/billingFeedback";
import { summariseCourse } from "@/lib/curriculum/courseSummary";
import { resolveDisplayName } from "@/lib/profile/displayName";
import type { StudentRecord } from "@/lib/students/studentsDal";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { formatDate } from "./studentPresentation";

const ACTION_LABEL: Record<string, string> = {
  pause: "Paused",
  cancel: "Cancelled",
  remove_subject: "Dropped a subject",
};

/**
 * The student's plan, with the same pause / resume / cancel controls a parent
 * has — the server's assertCanManage now admits a tutor, and the feedback
 * policy mirrors it, so the existing components work unchanged. Pause and
 * cancel sit under the plan history. The tutor is never the payer, so the
 * Stripe portal is not offered.
 */
export function StudentBilling({ record, name }: { record: StudentRecord; name: string }) {
  const { subscription: sub, profile, enrolments, parents, billingFeedback } = record;
  const { data: packages = [], isPending } = usePackages(profile.level);
  // While a deletion is booked the plan is held paused by it; resuming or
  // changing it here would bill a student who can no longer sign in.
  const { data: deletion } = useAccountDeletion(profile.id);

  if (isPending) return <Spinner label="Loading plan" className="py-12" />;

  const activePkg = packages.find((p) => p.tier === sub?.plan);
  const priceLabel = activePkg
    ? `${formatPence(activePkg.price_pence)} ${billingIntervalLabel(activePkg.billing_interval)}`.trim()
    : undefined;
  const planName = sub ? planLabel(sub.plan, packages) : "";
  const course = summariseCourse(profile.level, enrolments);
  const payer = sub
    ? sub.user_id === profile.id
      ? name
      : (parents.find((p) => p.parent_id === sub.user_id)?.display_name ?? null)
    : null;
  const payerLabel = sub
    ? sub.user_id === profile.id
      ? "the student"
      : payer
        ? resolveDisplayName(payer, null)
        : "a parent"
    : undefined;

  return (
    <div className="space-y-6">
      {sub ? (
        <SubscriptionPanel
          sub={sub}
          planName={planName}
          canManage={!deletion}
          isPayer={false}
          returnTo="billing"
          payerLabel={payerLabel}
          priceLabel={priceLabel}
          course={course}
          // No Subjects block on the record page, so the plan names them.
          showSubjects
        />
      ) : (
        <EmptyState
          title="No plan"
          body="This student has never subscribed. Only the student or a linked parent can start one."
          mascot="books"
          compact
        />
      )}

      {billingFeedback.length > 0 && (
        <section className="premium-card rounded-2xl p-5 sm:p-6">
          <SectionHeading title="Plan history" hint="Reasons given when the plan was changed." />
          <ul className="divide-border mt-2 divide-y">
            {billingFeedback.map((f) => (
              <li key={f.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip tint-slate text-[10px]">
                    {ACTION_LABEL[f.action] ?? f.action}
                  </span>
                  <span className="font-semibold">
                    {BILLING_FEEDBACK_REASONS.find((r) => r.value === f.reason_category)?.label ??
                      f.reason_category ??
                      "No reason given"}
                  </span>
                  <span className="text-muted-foreground text-xs">{formatDate(f.created_at)}</span>
                </div>
                {f.reason && (
                  <p className="text-muted-foreground mt-1 text-xs italic">“{f.reason}”</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sub && (
        <PlanLifecycleActions
          sub={sub}
          planName={planName}
          canManage={!deletion}
          ownerLabel={name}
          course={course}
        />
      )}

      <DeleteAccountSection studentId={profile.id} name={name} />
    </div>
  );
}
