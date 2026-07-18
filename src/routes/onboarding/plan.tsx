import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Mail, CreditCard, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSignOut } from "@/hooks/useSignOut";
import { usePackages } from "@/hooks/data/useBilling";
import { startCheckout, formatPence, billingIntervalLabel } from "@/lib/billing";

type SearchParams = { checkout?: "success" | "cancelled" };

/**
 * Step 5 — the paywall.
 *
 * Two ways through, because the people who use this app and the people who own
 * the bank cards are usually not the same person:
 *
 *   • pay now — Stripe Checkout, in the student's own name.
 *   • ask a parent — emails an invite. The parent signs up, links, and pays for
 *     them. The student's account stays locked until that lands, so this page
 *     also has to be a decent waiting room.
 */
export const Route = createFileRoute("/onboarding/plan")({
  head: () => ({ meta: [{ title: "Choose a plan | Anglian Learning" }] }),
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    checkout:
      search.checkout === "success" || search.checkout === "cancelled"
        ? search.checkout
        : undefined,
  }),
  component: PlanStep,
});

function PlanStep() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const signOut = useSignOut();

  const { data: packages = [], isLoading: loading } = usePackages();
  // A student landing here with a paused (or period-end-cancelled) plan should
  // resume it from Billing, not buy a second one on top.
  const [pausedPlan, setPausedPlan] = useState(false);
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("status, cancel_at_period_end")
        .eq("student_id", u.user.id)
        .maybeSingle();
      setPausedPlan(sub?.status === "paused" || !!sub?.cancel_at_period_end);
    })();
  }, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [parentEmail, setParentEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [invited, setInvited] = useState(false);

  // Preselect the monthly plan (or the first one) once packages arrive.
  useEffect(() => {
    if (selected || packages.length === 0) return;
    setSelected(packages.find((p) => p.tier === "monthly")?.tier ?? packages[0]?.tier ?? null);
  }, [packages, selected]);

  /**
   * Coming back from Stripe means the payment succeeded, not that we know about
   * it yet — the webhook is a separate round trip and usually lands within a
   * second or two. Poll for it rather than trusting the redirect, which is just
   * a URL the student could have typed.
   */
  useEffect(() => {
    if (search.checkout !== "success") return;
    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      const { data } = await supabase.rpc("my_access_state").single();
      if (cancelled) return;
      if (data?.has_access) {
        toast.success("You're all set — welcome to Anglian Learning.");
        navigate({ to: "/dashboard" });
        return;
      }
      if (++attempts < 15) setTimeout(poll, 1000);
      else if (!cancelled) {
        toast.error(
          "Payment went through, but we haven't had confirmation yet. Refresh in a moment.",
        );
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [search.checkout, navigate]);

  useEffect(() => {
    if (search.checkout === "cancelled") toast.info("Checkout cancelled — nothing was charged.");
  }, [search.checkout]);

  const payNow = async () => {
    if (!selected) return;
    setRedirecting(true);
    try {
      await startCheckout({ tier: selected, returnTo: "onboarding" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open checkout — try again.");
      setRedirecting(false);
    }
  };

  const inviteParent = async () => {
    if (!parentEmail.trim()) return toast.error("Enter your parent's email first.");
    setInviting(true);
    try {
      const { error } = await supabase.rpc("invite_parent_by_email", {
        _email: parentEmail.trim().toLowerCase(),
      });
      if (error) throw error;
      setInvited(true);
      toast.success("Invite sent.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send that invite.");
    } finally {
      setInviting(false);
    }
  };

  if (search.checkout === "success") {
    return (
      <div className="rounded-2xl bg-card border border-border p-10 shadow-lg text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary mb-4" />
        <h1 className="font-display text-2xl font-semibold tracking-tight mb-2">
          Confirming your payment…
        </h1>
        <p className="text-sm text-muted-foreground">
          This usually takes a couple of seconds. Don't close this tab.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {pausedPlan && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5 text-sm">
          <p className="font-semibold text-amber-900 mb-1">You already have a plan on hold</p>
          <p className="text-amber-800">
            It's paused or set to end — resume it from{" "}
            <button
              type="button"
              onClick={() => navigate({ to: "/billing" })}
              className="font-semibold underline"
            >
              Billing
            </button>{" "}
            instead of buying a new one, and your access comes straight back.
          </p>
        </div>
      )}
      <div className="rounded-2xl bg-card border border-border p-6 shadow-lg">
        <h1 className="font-display text-2xl font-semibold tracking-tight mb-1">
          Last step — pick your plan
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          Your profile's ready. Choose how you'd like to pay, and your dashboard unlocks straight
          away. Cancel anytime.
        </p>

        {loading ? (
          <div className="py-8 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
          </div>
        ) : packages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No plans are available right now. Please get in touch.
          </p>
        ) : (
          <div className="space-y-2">
            {packages.map((p) => (
              <button
                key={p.tier}
                type="button"
                onClick={() => setSelected(p.tier)}
                className={`w-full text-left rounded-xl border p-4 transition flex items-center gap-4 ${
                  selected === p.tier
                    ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                    : "border-border bg-muted/40 hover:border-primary/50"
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    selected === p.tier ? "border-primary bg-primary" : "border-border"
                  }`}
                >
                  {selected === p.tier && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{p.name}</div>
                  {p.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">{p.description}</div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-display font-bold">{formatPence(p.price_pence)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {billingIntervalLabel(p.billing_interval)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={payNow}
          disabled={!selected || redirecting || loading}
          className="mt-6 w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 disabled:opacity-50 text-sm shadow-sm inline-flex items-center justify-center gap-2"
        >
          {redirecting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Taking you to Stripe…
            </>
          ) : (
            <>
              <CreditCard className="w-4 h-4" /> Pay with card
            </>
          )}
        </button>
        <p className="mt-3 text-[11px] text-muted-foreground text-center">
          Payments are handled by Stripe. We never see or store your card details.
        </p>
      </div>

      <div className="rounded-2xl bg-card border border-border p-6 shadow-lg">
        <div className="flex items-center gap-2 mb-1">
          <Mail className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-display text-base font-semibold">Not your card to use?</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Send your parent or guardian an invite. Once they link to your account, they can pay for
          you — your account unlocks the moment they do.
        </p>

        {invited ? (
          <div className="rounded-xl bg-muted/60 border border-border p-4 flex gap-3">
            <Clock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground leading-relaxed">
              <p className="font-semibold text-foreground mb-1">Invite sent to {parentEmail}</p>
              <p>
                They'll get an email with a link to join and pay. You can close this — sign back in
                any time and you'll come straight back here. We'll let you in as soon as payment
                lands.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="email"
              value={parentEmail}
              onChange={(e) => setParentEmail(e.target.value)}
              placeholder="parent@example.com"
              className="flex-1 h-10 rounded-lg bg-muted border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              type="button"
              onClick={inviteParent}
              disabled={inviting}
              className="h-10 px-4 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-50 shrink-0"
            >
              {inviting ? "Sending…" : "Send invite"}
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => navigate({ to: "/onboarding/school" })}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back to your profile
        </button>
        <button
          type="button"
          onClick={signOut}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
