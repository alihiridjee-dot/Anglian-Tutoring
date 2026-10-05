import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { ErrorNote, SectionHeading, Spinner } from "@/components/Shared";
import { PaymentPending } from "@/components/billing/PaymentPending";
import { supabase } from "@/integrations/supabase/client";
import { useChildLinks } from "@/hooks/data/useParentLinks";
import {
  usePaidSubscriptions,
  useRawPackages,
  useStudentLevels,
  useSubscriptions,
} from "@/hooks/data/useBilling";
import {
  isSubscriptionLive,
  isPaymentOverdue,
  isPlanChangeable,
  planLabel,
  resolvePackagesForLevel,
  formatPence,
  billingIntervalLabel,
  type PackageRow,
  type SubscriptionRow,
} from "@/lib/billing/billing";
import { CadenceSwitcher } from "@/components/billing/CadenceSwitcher";
import { SubscriptionPanel } from "@/components/billing/SubscriptionPanel";
import { PlanLifecycleActions } from "@/components/billing/PlanLifecycleActions";
import { AddSubjectTiles } from "@/components/billing/AddSubjectCard";
import { EnrolledSubjectsCard } from "@/components/billing/EnrolledSubjectsCard";
import { InvoiceHistoryCard } from "@/components/billing/InvoiceHistory";
import { resolveDisplayName } from "@/lib/profile/displayName";
import { summariseCourse } from "@/lib/curriculum/courseSummary";
import { type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";

/** Formatted recurring price for a tier, or undefined if it isn't priced here. */
function priceLabelFor(packages: PackageRow[], tier: string | null | undefined) {
  const pkg = packages.find((p) => p.tier === tier);
  if (!pkg) return undefined;
  return `${formatPence(pkg.price_pence)} ${billingIntervalLabel(pkg.billing_interval)}`.trim();
}

/**
 * One linked child's billing: their plan and how to change it, or the cadence
 * picker if they don't have one yet.
 *
 * The child's enrolment is fetched once here (parents may read
 * student_enrolments for a linked child) and shared by every card — the cancel
 * dialog needs it to list what's being lost, and CadenceSwitcher needs the
 * subject count to price each rhythm, so it can't live inside the subject card
 * alone.
 */
function ChildPlan({
  studentId,
  sub,
  childName,
  packages,
  level,
  isPayer,
  hadPlan,
}: {
  studentId: string;
  /** Their live/paused subscription, or null when they have no plan. */
  sub: SubscriptionRow | null;
  /** They have a subscription row, even an ended one: no free trial. */
  hadPlan: boolean;
  childName: string;
  packages: PackageRow[];
  level: string | null | undefined;
  isPayer: boolean;
}) {
  const { data: enrolments = [] } = useQuery({
    queryKey: ["child-progress", "enrolments", studentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_enrolments")
        .select("subject, board")
        .eq("student_id", studentId)
        .order("subject");
      if (error) throw new Error(error.message);
      return (data ?? []) as { subject: string; board: BoardV }[];
    },
  });

  const anchorId = `subjects-${studentId}`;
  // Only a live plan that isn't cancelling can have subjects added or removed,
  // or its cadence changed — the server rejects a paused or cancelling one, so
  // don't offer any of it.
  const changeable = !!sub?.plan && isPlanChangeable(sub);
  const planName = sub ? planLabel(sub.plan, packages) : "";
  const course = summariseCourse(level as LevelV | null, enrolments);

  return (
    <>
      {sub ? (
        <SubscriptionPanel
          sub={sub}
          planName={planName}
          // A linked parent manages the plan regardless of who paid — including a
          // plan the child originally paid for themselves.
          canManage
          isPayer={isPayer}
          returnTo="billing"
          payerLabel={isPayer ? "you" : childName}
          priceLabel={priceLabelFor(packages, sub.plan)}
          // Same course facts the child sees on their own page — a parent
          // checking the plan should be able to catch a wrong board too, even
          // though only the child can write the change.
          course={course}
          // A paused or ending plan has no Subjects block below to name them.
          showSubjects={!changeable}
        />
      ) : null}

      {changeable && sub?.plan && (
        <div className="mt-6">
          <EnrolledSubjectsCard
            studentId={studentId}
            currentTier={sub.plan}
            enrolments={enrolments}
            level={level}
            canManage
            ownerLabel={childName}
            anchorId={anchorId}
            extraTiles={
              <AddSubjectTiles
                studentId={studentId}
                currentTier={sub.plan}
                enrolledSubjects={enrolments.map((e) => e.subject)}
                defaultBoard={enrolments[0]?.board}
                ownerLabel={childName}
                level={level}
              />
            }
          />
        </div>
      )}

      {(changeable || !sub) && (
        <div className="mt-6">
          <CadenceSwitcher
            studentId={studentId}
            currentTier={sub?.plan ?? null}
            subjectCount={enrolments.length}
            level={level}
            canManage
            ownerLabel={childName}
            hadPlan={hadPlan}
          />
        </div>
      )}

      {/* Pause and cancel come last, under everything else for this child. */}
      {sub && (
        <div className="mt-6">
          <PlanLifecycleActions
            sub={sub}
            planName={planName}
            canManage
            ownerLabel={childName}
            course={course}
            subjectsAnchorId={anchorId}
          />
        </div>
      )}
    </>
  );
}

/**
 * The parent's Billing tab: one card per linked child showing their plan (pause
 * / cancel / resume, plus adding and removing subjects) or the plan picker if
 * they have none, and the parent's own payment history.
 *
 * Lifted out of the Parent Portal dashboard into its own /billing tab — the
 * dashboard is progress-only now. A linked parent manages the child's plan even
 * one the child paid for themselves (the server enforces the same rule). The
 * billing portal is the one payer-only control, since it is tied to whoever's
 * card the plan sits on.
 */
export function ParentBillingSection({
  parentId,
  awaitingPayment = false,
}: {
  parentId: string;
  /** Just back from Checkout: a child with no plan yet may simply not show it yet. */
  awaitingPayment?: boolean;
}) {
  const childrenQuery = useChildLinks();
  const { data: children = [], isLoading: childrenLoading } = childrenQuery;
  const studentIds = useMemo(() => children.map((c) => c.student_id), [children]);
  const subsQuery = useSubscriptions(studentIds);
  const { data: subs = [] } = subsQuery;
  // Plans on this parent's card for a student who has since removed them. They
  // keep running, and only the payer can change or cancel them.
  const paidQuery = usePaidSubscriptions(parentId);
  const unlinkedPaid = (paidQuery.data ?? []).filter(
    (s) =>
      !studentIds.includes(s.student_id) &&
      (isSubscriptionLive(s.status) || s.status === "paused" || isPaymentOverdue(s.status)),
  );
  // Children may sit different levels, so prices resolve per child rather than
  // once for the whole tab.
  const { data: allPackages = [] } = useRawPackages();
  const { data: levels = {} } = useStudentLevels(studentIds);

  if (childrenLoading) return <Spinner label="Loading" className="py-8" />;

  // A failed read of either list must not be drawn as its empty state. "No
  // children linked" hides every plan; "no subscriptions" is worse — it offers a
  // parent who is already paying the chance to pay for the same child again.
  const loadError = childrenQuery.error ?? subsQuery.error ?? paidQuery.error;
  if (loadError) {
    return (
      <ErrorNote
        error={loadError}
        onRetry={() => {
          void childrenQuery.refetch();
          void subsQuery.refetch();
          void paidQuery.refetch();
        }}
      />
    );
  }
  // The plans haven't been read yet, so nothing can be said about who has one.
  if (children.length > 0 && subsQuery.isPending) {
    return <Spinner label="Loading" className="py-8" />;
  }

  return (
    <div data-guide="parent-billing">
      <div className="flex items-center gap-3 mb-5">
        <CreditCard className="w-5 h-5 text-primary" />
        <h2 className="font-display text-xl font-bold text-foreground">Billing &amp; plans</h2>
      </div>

      {unlinkedPaid.length > 0 && (
        <div className="space-y-10 mb-10">
          {unlinkedPaid.map((sub) => (
            // No name or course: the student removed this link, so all that is
            // shown is the plan on this parent's card and the controls for it.
            <section key={sub.student_id}>
              <SectionHeading title="A plan on your card" />
              <div className="mt-3">
                <SubscriptionPanel
                  sub={sub}
                  planName={planLabel(sub.plan, resolvePackagesForLevel(allPackages, undefined))}
                  canManage
                  isPayer
                  returnTo="billing"
                  payerLabel="you"
                />
              </div>
              <div className="mt-6">
                <PlanLifecycleActions
                  sub={sub}
                  planName={planLabel(sub.plan, resolvePackagesForLevel(allPackages, undefined))}
                  canManage
                  ownerLabel="this student"
                />
              </div>
            </section>
          ))}
        </div>
      )}

      {children.length === 0 ? (
        <div className="pop-card p-4 sm:p-5 text-sm">
          Link to your child from their Settings page to pay for and manage their plan here.
        </div>
      ) : (
        <div className="space-y-10">
          {children.map((child) => {
            const sub = subs.find((s) => s.student_id === child.student_id) ?? null;
            // An overdue plan still needs its panel: the card-update button is
            // the way out, and the shop underneath would only be refused.
            const hasUsablePlan =
              !!sub &&
              (isSubscriptionLive(sub.status) ||
                sub.status === "paused" ||
                isPaymentOverdue(sub.status));
            const childName = resolveDisplayName(child.display_name, child.email);
            const packages = resolvePackagesForLevel(allPackages, levels[child.student_id]);

            return (
              // A headed section per child, not a card: the plan, subjects
              // and cadence inside are tiles already.
              <section key={child.link_id}>
                <SectionHeading title={`${childName}'s plan`} />
                <div className="mt-3">
                  {!hasUsablePlan && awaitingPayment && (
                    <PaymentPending delayed={false} onRetry={() => undefined} />
                  )}
                  {!hasUsablePlan && !awaitingPayment && (
                    <p className="pop-card mb-4 p-4 text-sm sm:p-5">
                      {sub
                        ? "Their previous plan has ended. Pick how often you'd like to pay to restart their access."
                        : `${childName} doesn't have an active plan. Pick how often you'd like to pay — you'll use your own card and can manage it here.`}
                    </p>
                  )}
                  {(hasUsablePlan || !awaitingPayment) && (
                    <ChildPlan
                      studentId={child.student_id}
                      // A dead subscription is treated as no plan: its controls are
                      // gone and what's needed is a fresh checkout, not management.
                      sub={hasUsablePlan ? sub : null}
                      childName={childName}
                      packages={packages}
                      level={levels[child.student_id]}
                      isPayer={sub?.user_id === parentId}
                      hadPlan={!!sub}
                    />
                  )}
                </div>
              </section>
            );
          })}

          <InvoiceHistoryCard />
        </div>
      )}
    </div>
  );
}
