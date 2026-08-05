import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CreditCard, Info } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useParentLinks } from "@/hooks/data/useParentLinks";
import { usePackages, useSubscriptions } from "@/hooks/data/useBilling";
import { isSubscriptionLive, planLabel, formatPence, billingIntervalLabel } from "@/lib/billing";
import { CadenceSwitcher } from "@/components/billing/CadenceSwitcher";
import { SubscriptionPanel } from "@/components/billing/SubscriptionPanel";
import { InvoiceHistoryCard } from "@/components/billing/InvoiceHistory";
import { AddSubjectCard } from "@/components/billing/AddSubjectCard";
import { EnrolledSubjectsCard } from "@/components/billing/EnrolledSubjectsCard";
import { ParentBillingSection } from "@/components/billing/ParentBillingSection";
import { resolveDisplayName } from "@/lib/displayName";
import { subjectLabel, summariseCourse } from "@/lib/courseSummary";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({ meta: [{ title: "Billing | Anglia Educate" }] }),
  component: BillingPage,
});

/** The Stripe reassurance + back-link, shared by both persona views. */
function StripeFooter() {
  return (
    <div className="mt-8 rounded-2xl bg-primary/5 border border-primary/20 p-6 text-sm">
      <p className="text-muted-foreground">
        Payments are handled by Stripe. Your card details go straight to them and are never seen or
        stored by Anglia Educate.
      </p>
      <Link
        to="/dashboard"
        className="text-primary mt-3 inline-block text-sm font-semibold hover:underline"
      >
        ← Back to dashboard
      </Link>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="font-display text-lg font-semibold mb-4">{children}</h3>;
}

/**
 * Billing — a full tab, one home for everything money-shaped.
 *
 * Everything here is a redirect to Stripe (checkout, portal) or a call into the
 * stripe-checkout edge function (pause/cancel/resume, add/remove subjects,
 * invoices). Card details are never entered into this app.
 *
 * Two personas share the route:
 *   • Parent — manages and pays for each linked child's plan, with payment
 *     history.
 *   • Student — their own plan.
 *
 * The student view answers three questions in order, because that is the order
 * people actually ask them: what am I on and *who is paying for it*, what does
 * it cover (and how do I drop one subject), and how do I stop. The last of those
 * lives in a danger strip inside SubscriptionPanel, behind a four-step gate.
 */
function BillingPage() {
  const { enrolledCourses, enrolments, role, level } = useEnrolments();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data: packages = [], isLoading: packagesLoading } = usePackages(level);
  const { data: subs = [], isLoading: subsLoading } = useSubscriptions(userId ? [userId] : []);
  // A student's linked parents (empty for the parent view) — used to name the
  // payer and to decide whether the student manages their own plan.
  const { data: linkedParents = [], isLoading: parentsLoading } = useParentLinks(role !== "parent");
  const sub = subs[0] ?? null;
  const loading = packagesLoading || subsLoading || userId === null;

  // ---- Parent: manage each linked child's plan + payment history. ----
  if (role === "parent") {
    return (
      <AppLayout title="Billing">
        <div className="max-w-4xl">
          {userId ? (
            <ParentBillingSection parentId={userId} />
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          <StripeFooter />
        </div>
      </AppLayout>
    );
  }

  // ---- Student: their own plan. ----
  const hasUsablePlan = !!sub && (isSubscriptionLive(sub.status) || sub.status === "paused");
  const activeTier = hasUsablePlan ? sub.plan : null;
  const isPayer = !!sub && !!userId && sub.user_id === userId;

  // Who controls the plan, mirroring assertCanManage() on the server: the payer
  // always — nobody is charged with no way to stop — or a student with no linked
  // parent. Only a student on someone else's card is read-only. Wait for the
  // links query so controls don't flicker in and then vanish.
  const linksSettled = !parentsLoading;
  const canManage = linksSettled && (isPayer || linkedParents.length === 0);

  // Name the payer rather than leaving it to be inferred. A linked parent who
  // holds the subscription is named; a payer we can't resolve is described
  // honestly instead of being guessed at.
  const payingParent = sub ? linkedParents.find((p) => p.parent_id === sub.user_id) : undefined;
  const payerLabel = !sub
    ? undefined
    : isPayer
      ? "you"
      : payingParent
        ? resolveDisplayName(payingParent.display_name, payingParent.email)
        : "someone else in your household";

  const planName = planLabel(sub?.plan, packages);
  const activePkg = packages.find((p) => p.tier === sub?.plan);
  const priceLabel = activePkg
    ? `${formatPence(activePkg.price_pence)} ${billingIntervalLabel(activePkg.billing_interval)}`.trim()
    : undefined;
  const subjectLabels = enrolments.map((e) => subjectLabel(e.subject));
  // Level + board — what the plan actually teaches. Mixed boards are named
  // per subject just below, in EnrolledSubjectsCard.
  const course = summariseCourse(level, enrolments);

  return (
    <AppLayout title="Billing">
      <div className="max-w-4xl">
        <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card p-6 mb-8 shadow-sm">
          {/* soft glow accent */}
          <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />

          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <CreditCard className="w-4 h-4 text-primary" />
              </div>
              <h2 className="font-display text-xl font-semibold">Current plan</h2>
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : hasUsablePlan && sub ? (
              <>
                <SubscriptionPanel
                  sub={sub}
                  planName={planName}
                  canManage={canManage}
                  isPayer={isPayer}
                  returnTo="billing"
                  payerLabel={payerLabel}
                  priceLabel={priceLabel}
                  course={course}
                  // The board is the student's own academic fact — theirs to set
                  // even on a plan a parent pays for.
                  canChangeBoard
                />
                {!canManage && linksSettled && (
                  <div className="mt-4 flex gap-2.5 rounded-xl border border-border bg-muted/40 p-3.5 text-sm text-muted-foreground">
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      This plan is paid for by{" "}
                      <strong className="text-foreground">{payerLabel}</strong>, so pausing,
                      changing and cancelling it happen from their account. Ask them to open their
                      own Billing tab — you'll see any change here straight away.
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div>
                <p className="text-muted-foreground">
                  You don't have an active plan yet. Pick one below to unlock lessons, quizzes, and
                  homework marking.
                </p>
                {/* Still say what they'd be buying — the course is set at
                    signup and is the thing worth checking before paying. */}
                {course.headline && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Set up for <strong className="text-foreground">{course.headline}</strong>
                    {subjectLabels.length > 0 && ` — ${subjectLabels.join(", ")}`}.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* What the plan covers, and where a single subject comes off it. Sits
            directly under the plan because "cancel Chemistry" is a far commoner
            intent than "cancel everything" — and the cancel dialog links here. */}
        {userId && hasUsablePlan && sub?.plan && (
          <div className="mb-8">
            <EnrolledSubjectsCard
              studentId={userId}
              currentTier={sub.plan}
              enrolments={enrolments}
              level={level}
              canManage={canManage}
              canChangeBoard
            />
          </div>
        )}

        {/* Frictionless upgrade: any student can add a subject to their own live
            plan — even when a parent holds the pause/cancel controls. Adding is
            additive growth, so it isn't gated the way the lifecycle actions are. */}
        {userId && hasUsablePlan && sub?.plan && (
          <div className="mb-8">
            <AddSubjectCard
              studentId={userId}
              currentTier={sub.plan}
              enrolledSubjects={enrolledCourses}
              defaultBoard={enrolments[0]?.board}
              level={level}
            />
          </div>
        )}

        {/* Billing rhythm only — three rows, not the old nine-card grid. What
            the plan covers is the subjects card's job, so a switch here can't
            change it (and can't sell coverage the student isn't enrolled in). */}
        {userId && (canManage || !hasUsablePlan) && (
          <div className="mb-8">
            <CadenceSwitcher
              studentId={userId}
              currentTier={activeTier}
              subjectCount={enrolments.length}
              level={level}
              canManage={canManage || !hasUsablePlan}
            />
          </div>
        )}

        {/* Shared household history: a student sees payments on their plan even
            when a linked parent's card was charged. Empty ("No payments yet")
            for a student with no plan and no linked payer. */}
        <div className="mt-8">
          <InvoiceHistoryCard />
        </div>

        <StripeFooter />
      </div>
    </AppLayout>
  );
}
