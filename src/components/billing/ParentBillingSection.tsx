import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useChildLinks } from "@/hooks/data/useParentLinks";
import { useRawPackages, useStudentLevels, useSubscriptions } from "@/hooks/data/useBilling";
import {
  isSubscriptionLive,
  planLabel,
  resolvePackagesForLevel,
  formatPence,
  billingIntervalLabel,
  type PackageRow,
  type SubscriptionRow,
} from "@/lib/billing";
import { CadenceSwitcher } from "@/components/billing/CadenceSwitcher";
import { SubscriptionPanel } from "@/components/billing/SubscriptionPanel";
import { AddSubjectCard } from "@/components/billing/AddSubjectCard";
import { EnrolledSubjectsCard } from "@/components/billing/EnrolledSubjectsCard";
import { InvoiceHistoryCard } from "@/components/billing/InvoiceHistory";
import { resolveDisplayName } from "@/lib/displayName";
import { summariseCourse } from "@/lib/courseSummary";
import { type BoardV, type LevelV } from "@/lib/taxonomy";

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
}: {
  studentId: string;
  /** Their live/paused subscription, or null when they have no plan. */
  sub: SubscriptionRow | null;
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
  // Only a live plan can have subjects added or removed, or its cadence changed
  // — the server rejects a paused or cancelling one, so don't offer any of it.
  const changeable = !!sub?.plan && isSubscriptionLive(sub.status);

  return (
    <>
      {sub ? (
        <SubscriptionPanel
          sub={sub}
          planName={planLabel(sub.plan, packages)}
          // A linked parent manages the plan regardless of who paid — including a
          // plan the child originally paid for themselves.
          canManage
          isPayer={isPayer}
          returnTo="billing"
          ownerLabel={childName}
          payerLabel={isPayer ? "you" : childName}
          priceLabel={priceLabelFor(packages, sub.plan)}
          // Same course facts the child sees on their own page — a parent
          // checking the plan should be able to catch a wrong board too, even
          // though only the child can write the change.
          course={summariseCourse(level as LevelV | null, enrolments)}
          subjectsAnchorId={anchorId}
        />
      ) : null}

      {changeable && sub?.plan && (
        <div className="mt-5 space-y-5">
          <EnrolledSubjectsCard
            studentId={studentId}
            currentTier={sub.plan}
            enrolments={enrolments}
            level={level}
            canManage
            ownerLabel={childName}
            anchorId={anchorId}
          />
          <AddSubjectCard
            studentId={studentId}
            currentTier={sub.plan}
            enrolledSubjects={enrolments.map((e) => e.subject)}
            defaultBoard={enrolments[0]?.board}
            ownerLabel={childName}
            level={level}
          />
        </div>
      )}

      {(changeable || !sub) && (
        <div className="mt-5">
          <CadenceSwitcher
            studentId={studentId}
            currentTier={sub?.plan ?? null}
            subjectCount={enrolments.length}
            level={level}
            canManage
            ownerLabel={childName}
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
export function ParentBillingSection({ parentId }: { parentId: string }) {
  const { data: children = [], isLoading: childrenLoading } = useChildLinks();
  const studentIds = useMemo(() => children.map((c) => c.student_id), [children]);
  const { data: subs = [] } = useSubscriptions(studentIds);
  // Children may sit different levels, so prices resolve per child rather than
  // once for the whole tab.
  const { data: allPackages = [] } = useRawPackages();
  const { data: levels = {} } = useStudentLevels(studentIds);

  if (childrenLoading) return null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <CreditCard className="w-5 h-5 text-primary" />
        <h2 className="font-display text-xl font-semibold text-foreground">Billing &amp; plans</h2>
      </div>

      {children.length === 0 ? (
        <div className="rounded-2xl premium-card p-6 text-sm text-muted-foreground">
          Link to your child from their Settings page to pay for and manage their plan here.
        </div>
      ) : (
        <div className="space-y-6">
          {children.map((child) => {
            const sub = subs.find((s) => s.student_id === child.student_id) ?? null;
            const hasUsablePlan =
              !!sub && (isSubscriptionLive(sub.status) || sub.status === "paused");
            const childName = resolveDisplayName(child.display_name, child.email);
            const packages = resolvePackagesForLevel(allPackages, levels[child.student_id]);

            return (
              <div
                key={child.link_id}
                className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-sm"
              >
                {/* soft glow accent (matches Add-subject card) */}
                <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />

                <div className="relative">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-3">
                    {childName}'s plan
                  </p>

                  {!hasUsablePlan && (
                    <p className="text-sm text-muted-foreground mb-4">
                      {sub
                        ? "Their previous plan has ended. Pick how often you'd like to pay to restart their access."
                        : `${childName} doesn't have an active plan. Pick how often you'd like to pay — you'll use your own card and can manage it here.`}
                    </p>
                  )}
                  <ChildPlan
                    studentId={child.student_id}
                    // A dead subscription is treated as no plan: its controls are
                    // gone and what's needed is a fresh checkout, not management.
                    sub={hasUsablePlan ? sub : null}
                    childName={childName}
                    packages={packages}
                    level={levels[child.student_id]}
                    isPayer={sub?.user_id === parentId}
                  />
                </div>
              </div>
            );
          })}

          <InvoiceHistoryCard />
        </div>
      )}
    </div>
  );
}
