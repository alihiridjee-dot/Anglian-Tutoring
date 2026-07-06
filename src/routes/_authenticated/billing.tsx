import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { CreditCard, Check, Zap } from "lucide-react";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({ meta: [{ title: "Billing | Anglian Tutoring" }] }),
  component: BillingPage,
});

type Package = {
  id: string;
  tier: string;
  name: string;
  description: string | null;
  subjects: string[];
  level: string | null;
  price_pence: number;
};
type Subscription = { status: string; plan: string | null; current_period_end: string | null };

function BillingPage() {
  const { userId } = useRoles();
  const { enrolledCourses, role } = useEnrolments();
  const [packages, setPackages] = useState<Package[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: p } = await supabase
        .from("packages")
        .select("id, tier, name, description, subjects, level, price_pence")
        .eq("active", true)
        .order("sort_order");
      setPackages((p ?? []) as Package[]);
      if (userId) {
        const { data: s } = await supabase
          .from("subscriptions")
          .select("status, plan, current_period_end")
          .eq("user_id", userId)
          .maybeSingle();
        setSub(s as Subscription | null);
      }
      setLoading(false);
    })();
  }, [userId]);

  const activeTier = sub?.plan ?? null;

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
          ) : sub && sub.status === "active" ? (
            <div>
              <p className="font-semibold text-lg">{sub.plan}</p>
              {sub.current_period_end && (
                <p className="text-sm text-muted-foreground">
                  Renews {new Date(sub.current_period_end).toLocaleDateString()}
                </p>
              )}
              <p className="text-sm text-muted-foreground mt-2">
                Enrolled subjects: {enrolledCourses.length ? enrolledCourses.join(", ") : "—"}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-muted-foreground">
                You don't have an active plan yet. Pick one below to unlock lessons, quizzes, and
                homework marking.
              </p>
              {role === "parent" && (
                <p className="text-xs text-muted-foreground mt-2">
                  Parent accounts don't need their own plan — you inherit access to your linked
                  child's subjects.
                </p>
              )}
            </div>
          )}
        </div>

        <h3 className="font-display text-lg font-semibold mb-4">Choose a plan</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {packages.map((p) => {
            const isCurrent = activeTier === p.tier;
            return (
              <div
                key={p.id}
                className={`rounded-2xl p-6 border ${isCurrent ? "border-accent bg-accent/5" : "border-border bg-card"}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="font-display font-semibold text-lg">{p.name}</h4>
                  {isCurrent && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-accent text-accent-foreground uppercase tracking-widest font-bold">
                      Current
                    </span>
                  )}
                </div>
                {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                <p className="mt-3 font-display text-3xl font-bold">
                  £{(p.price_pence / 100).toFixed(0)}
                  <span className="text-sm text-muted-foreground font-normal">/mo</span>
                </p>
                {p.subjects.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {p.subjects.map((s) => (
                      <li key={s} className="text-sm flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-accent" />{" "}
                        {s[0].toUpperCase() + s.slice(1)}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  disabled={isCurrent}
                  className="mt-5 w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-40"
                >
                  {isCurrent ? "Active" : "Upgrade / switch"}
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-8 rounded-2xl bg-primary/5 border border-primary/20 p-6 text-sm">
          <div className="flex items-center gap-2 font-semibold text-primary mb-2">
            <Zap className="w-4 h-4" /> Stripe checkout coming online
          </div>
          <p className="text-muted-foreground">
            The checkout, webhook, and automatic subject enrolment go live as soon as your Stripe
            account is connected. Once that step is done, clicking a plan above starts a real Stripe
            checkout and your subjects unlock automatically after payment.
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
