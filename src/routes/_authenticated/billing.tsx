import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { usePackages, useSubscriptions } from "@/hooks/data/useBilling";
import { startCheckout, isSubscriptionLive, planLabel } from "@/lib/billing";
import { PlanPicker } from "@/components/billing/PlanPicker";
import { SubscriptionPanel } from "@/components/billing/SubscriptionPanel";
import { InvoiceHistoryCard } from "@/components/billing/InvoiceHistory";
import { CreditCard } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({ meta: [{ title: "Billing | Anglian Learning" }] }),
  component: BillingPage,
});

/**
 * Billing — the student's own plan.
 *
 * Everything money-shaped is a redirect to Stripe (checkout, portal) or a call
 * into the stripe-checkout edge function (pause/cancel/resume, invoices). Card
 * details are never entered into this app.
 *
 * A subscription covering this student is not necessarily *paid* by them — a
 * parent may fund it. Non-payers see status but no controls; parents manage
 * their children's plans from the parent dashboard instead.
 */
function BillingPage() {
  const { enrolledCourses, role } = useEnrolments();
  const [userId, setUserId] = useState<string | null>(null);
  const [busyTier, setBusyTier] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data: packages = [], isLoading: packagesLoading } = usePackages();
  const { data: subs = [], isLoading: subsLoading } = useSubscriptions(userId ? [userId] : []);
  const sub = subs[0] ?? null;
  const loading = packagesLoading || subsLoading || userId === null;

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
  // Someone else is footing the bill — don't offer this student controls that
  // aren't theirs, or a plan switch that would charge the wrong card.
  const isPayer = !!sub && !!userId && sub.user_id === userId;
  const paidByParent = !!sub && !isPayer;
  const planName = planLabel(sub?.plan, packages);

  return (
    <AppLayout title="Billing">
      <div className="max-w-4xl">
        <div className="rounded-2xl bg-card border border-border p-6 mb-8">
          <div className="flex items-center gap-3 mb-2">
            <CreditCard className="w-5 h-5 text-primary" />
            <h2 className="font-display text-xl font-semibold">Current plan</h2>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : role === "parent" ? (
            <p className="text-muted-foreground text-sm">
              Parent accounts don't need their own plan — you see the children you're linked to. Pay
              for and manage a child's plan from the{" "}
              <Link to="/parent-dashboard" className="text-primary font-semibold hover:underline">
                parent dashboard
              </Link>
              .
            </p>
          ) : hasUsablePlan && sub ? (
            <div>
              <SubscriptionPanel
                sub={sub}
                planName={planName}
                isPayer={isPayer}
                returnTo="billing"
              />
              <p className="text-sm text-muted-foreground mt-3">
                Enrolled subjects: {enrolledCourses.length ? enrolledCourses.join(", ") : "—"}
              </p>
              {paidByParent && (
                <p className="text-sm text-muted-foreground mt-3">
                  This plan is paid for by your linked parent — they can pause, change or cancel it
                  from their own account.
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

        {role !== "parent" && !paidByParent && (
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

        {role !== "parent" && isPayer && (
          <div className="mt-8">
            <InvoiceHistoryCard />
          </div>
        )}

        <div className="mt-8 rounded-2xl bg-primary/5 border border-primary/20 p-6 text-sm">
          <p className="text-muted-foreground">
            Payments are handled by Stripe. Your card details go straight to them and are never seen
            or stored by Anglian Learning.
          </p>
          <Link
            to="/dashboard"
            className="text-primary mt-3 inline-block text-sm font-semibold hover:underline"
          >
            ← Back to dashboard
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}
