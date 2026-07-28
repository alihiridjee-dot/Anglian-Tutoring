import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useParentLinks } from "@/hooks/data/useParentLinks";
import { usePackages, useSubscriptions } from "@/hooks/data/useBilling";
import { startCheckout, isSubscriptionLive, planLabel } from "@/lib/billing";
import { PlanPicker } from "@/components/billing/PlanPicker";
import { SubscriptionPanel } from "@/components/billing/SubscriptionPanel";
import { InvoiceHistoryCard } from "@/components/billing/InvoiceHistory";
import { AddSubjectCard } from "@/components/billing/AddSubjectCard";
import { ParentBillingSection } from "@/components/billing/ParentBillingSection";
import { CreditCard } from "lucide-react";
import { toast } from "sonner";

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

/**
 * Billing — a full tab, one home for everything money-shaped.
 *
 * Everything here is a redirect to Stripe (checkout, portal) or a call into the
 * stripe-checkout edge function (pause/cancel/resume/delete, invoices). Card
 * details are never entered into this app.
 *
 * Two personas share the route:
 *   • Parent — manages and pays for each linked child's plan, with payment
 *     history. This is where the parent's billing lives now that it has been
 *     lifted out of the Parent Portal dashboard.
 *   • Student — their own plan. A subscription covering a student is not
 *     necessarily *paid* by them (a parent may fund it); non-payers see status
 *     but no controls.
 */
function BillingPage() {
  const { enrolledCourses, enrolments, role, level } = useEnrolments();
  const [userId, setUserId] = useState<string | null>(null);
  const [busyTier, setBusyTier] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data: packages = [], isLoading: packagesLoading } = usePackages(level);
  const { data: subs = [], isLoading: subsLoading } = useSubscriptions(userId ? [userId] : []);
  // A student's linked parents (empty for the parent view). Once linked, the
  // parent owns billing control — the student's own controls disappear.
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
  const chooseTier = async (tier: string) => {
    setBusyTier(tier);
    try {
      await startCheckout({ tier, returnTo: "billing" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open checkout — try again.");
      setBusyTier(null);
    }
  };

  const hasUsablePlan = !!sub && (isSubscriptionLive(sub.status) || sub.status === "paused");
  const activeTier = hasUsablePlan ? sub.plan : null;
  const isPayer = !!sub && !!userId && sub.user_id === userId;
  // Control is link-based: once a parent is linked, they manage billing and the
  // student can't interfere — even with a plan the student paid for themselves.
  // Only an unlinked student keeps controls (and the plan switcher) on their own
  // platform. Wait for the links query so controls don't flicker in then vanish.
  const hasLinkedParent = linkedParents.length > 0;
  const managedByParent = hasLinkedParent && !parentsLoading;
  const planName = planLabel(sub?.plan, packages);

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
              <div>
                <SubscriptionPanel
                  sub={sub}
                  planName={planName}
                  canManage={!managedByParent}
                  isPayer={isPayer && !managedByParent}
                  returnTo="billing"
                />
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Enrolled subjects
                  </div>
                  {enrolledCourses.length ? (
                    <div className="flex flex-wrap gap-2">
                      {enrolledCourses.map((course) => (
                        <span
                          key={course}
                          className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-sm font-medium capitalize text-foreground"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                          {course}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
                {managedByParent && (
                  <p className="text-sm text-muted-foreground mt-4 rounded-xl border border-border bg-muted/40 p-3">
                    Billing for this plan is managed by your linked parent from their account —
                    including pausing, changing or cancelling it.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">
                You don't have an active plan yet. Pick one below to unlock lessons, quizzes, and
                homework marking.
              </p>
            )}
          </div>
        </div>

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

        {!managedByParent && (
          <>
            <h3 className="font-display text-lg font-semibold mb-4">
              {activeTier ? "Switch plan" : "Choose a plan"}
            </h3>
            <PlanPicker
              packages={packages}
              activeTier={activeTier}
              busyTier={busyTier}
              onChoose={chooseTier}
            />
          </>
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
