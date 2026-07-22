import { useMemo, useState } from "react";
import { CreditCard } from "lucide-react";
import { toast } from "sonner";
import { useChildLinks } from "@/hooks/data/useParentLinks";
import { usePackages, useSubscriptions } from "@/hooks/data/useBilling";
import { startCheckout, isSubscriptionLive, planLabel } from "@/lib/billing";
import { PlanPicker } from "@/components/billing/PlanPicker";
import { SubscriptionPanel } from "@/components/billing/SubscriptionPanel";
import { InvoiceHistoryCard } from "@/components/billing/InvoiceHistory";
import { resolveDisplayName } from "@/lib/displayName";

/**
 * The parent's Billing tab: one card per linked child showing their plan (with
 * pause / cancel / resume / delete) or the plan picker if they have none, plus
 * the parent's own payment history.
 *
 * Lifted out of the Parent Portal dashboard into its own /billing tab — the
 * dashboard is progress-only now. Control is link-based: a linked parent manages
 * the child's plan even one the child paid for themselves (the server enforces
 * the same rule). The billing portal is the one payer-only control, since it is
 * tied to whoever's card the plan sits on.
 */
export function ParentBillingSection({ parentId }: { parentId: string }) {
  const { data: children = [], isLoading: childrenLoading } = useChildLinks();
  const studentIds = useMemo(() => children.map((c) => c.student_id), [children]);
  const { data: subs = [] } = useSubscriptions(studentIds);
  const { data: packages = [] } = usePackages();
  const [busy, setBusy] = useState<string | null>(null); // `${studentId}:${tier}`

  const choosePlan = async (studentId: string, tier: string) => {
    setBusy(`${studentId}:${tier}`);
    try {
      await startCheckout({ tier, studentId, returnTo: "billing" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open checkout — try again.");
      setBusy(null);
    }
  };

  if (childrenLoading) return null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <CreditCard className="w-5 h-5 text-primary" />
        <h2 className="font-display text-xl font-semibold text-slate-900">Billing &amp; plans</h2>
      </div>

      {children.length === 0 ? (
        <div className="rounded-2xl bg-card border border-border p-6 text-sm text-muted-foreground">
          Link to your child from their Settings page to pay for and manage their plan here.
        </div>
      ) : (
        <div className="space-y-6">
          {children.map((child) => {
            const sub = subs.find((s) => s.student_id === child.student_id) ?? null;
            const hasUsablePlan =
              !!sub && (isSubscriptionLive(sub.status) || sub.status === "paused");
            const childName = resolveDisplayName(child.display_name, child.email);
            const planName = planLabel(sub?.plan, packages);

            return (
              <div key={child.link_id} className="rounded-2xl bg-card border border-border p-6">
                <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-3">
                  {childName}'s plan
                </p>

                {hasUsablePlan && sub ? (
                  <SubscriptionPanel
                    sub={sub}
                    planName={planName}
                    // A linked parent manages the plan regardless of who paid —
                    // including a plan the child originally paid for themselves.
                    canManage
                    isPayer={sub.user_id === parentId}
                    returnTo="billing"
                    ownerLabel={childName}
                  />
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground mb-4">
                      {sub
                        ? "Their previous plan has ended. Pick a plan to restart their access."
                        : `${childName} doesn't have an active plan. Choose one below — you'll pay with your own card and can manage it here.`}
                    </p>
                    <PlanPicker
                      packages={packages}
                      activeTier={null}
                      busyTier={
                        busy?.startsWith(`${child.student_id}:`)
                          ? busy.slice(child.student_id.length + 1)
                          : null
                      }
                      onChoose={(tier) => choosePlan(child.student_id, tier)}
                    />
                  </>
                )}
              </div>
            );
          })}

          <InvoiceHistoryCard />
        </div>
      )}
    </div>
  );
}
