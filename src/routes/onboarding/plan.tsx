import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, Mail, CreditCard, Clock, Pencil, GraduationCap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { invalidateGuardState } from "@/lib/auth/guardState";
import { useSignOut } from "@/hooks/useSignOut";
import { usePackages, useOwnPlanState } from "@/hooks/data/useBilling";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { startCheckout, formatPence } from "@/lib/billing";
import { SUBJECTS, BOARDS, LEVELS } from "@/lib/taxonomy";

type SearchParams = { checkout?: "success" | "cancelled" };

/** Billing cadences, in display order. Each maps to the `${key}_${n}` tiers. */
type Cadence = "weekly" | "monthly" | "termly";
const CADENCES: { key: Cadence; label: string; unit: string; note?: string }[] = [
  { key: "weekly", label: "Weekly", unit: "per week" },
  { key: "monthly", label: "Monthly", unit: "per month", note: "Best value" },
  { key: "termly", label: "Termly", unit: "per term" },
];

const labelFor = (list: readonly { value: string; label: string }[], value: string | null) =>
  list.find((x) => x.value === value)?.label ?? value ?? "";

/**
 * Step 5 — the paywall / resubscribe page.
 *
 * Rather than a flat wall of tiers, this reads the subjects and level the
 * student already chose in onboarding and builds ONE price from them, the way
 * the exam builder does. The subject count is derived from their enrolments, so
 * a student enrolled in one subject can only ever be sold the one-subject plan —
 * the mismatch that used to slip a 1-subject student onto a 2-subject tier
 * simply can't happen. The only choice left here is how often to pay:
 * weekly, monthly, or termly.
 *
 * Two ways through, because the people who use this app and the people who own
 * the bank cards are usually not the same person:
 *
 *   • pay now — Stripe Checkout, in the student's own name.
 *   • ask a parent — emails an invite. The parent signs up, links, and pays.
 */
export const Route = createFileRoute("/onboarding/plan")({
  head: () => ({ meta: [{ title: "Choose a plan | Anglia Educate" }] }),
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
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const signOut = useSignOut();

  const { enrolments, level, loading: loadingEnrolments } = useEnrolments();
  const { data: packages = [], isLoading: loadingPackages } = usePackages(level);
  const loading = loadingPackages || loadingEnrolments;

  // The plan size is the student's actual number of enrolled subjects, clamped
  // to the tiers we sell (1–3). This is the whole point: they don't pick a size,
  // it's read from what they're studying, so price and enrolment can't disagree.
  const subjectCount = Math.min(Math.max(enrolments.length, 1), 3);

  // A student landing here with a paused (or period-end-cancelled) plan must
  // resume it, not buy a second one on top — see useOwnPlanState for why that
  // would quietly double-bill the family. When it's true this page stops being
  // a shop entirely; the edge function refuses the purchase as well.
  const { resumable, isPending: planStatePending } = useOwnPlanState();

  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [redirecting, setRedirecting] = useState(false);
  const [parentEmail, setParentEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [invited, setInvited] = useState(false);

  // Preselect the cadence the student picked on the pricing page (stashed in
  // auth metadata at signup as e.g. "weekly_2"); otherwise keep monthly.
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const intended = u.user?.user_metadata?.intended_tier as string | undefined;
      const match = CADENCES.find((c) => intended?.startsWith(c.key));
      if (match) setCadence(match.key);
    })();
  }, []);

  // The concrete package for a cadence at this student's subject count.
  const packageFor = useMemo(
    () => (c: Cadence) => packages.find((p) => p.tier === `${c}_${subjectCount}`),
    [packages, subjectCount],
  );
  const selectedPkg = packageFor(cadence);
  const selectedUnit = CADENCES.find((c) => c.key === cadence)!.unit;

  /**
   * Coming back from Stripe means the payment succeeded, not that we know about
   * it yet — the webhook is a separate round trip. Poll for it rather than
   * trusting the redirect, which is just a URL the student could have typed.
   */
  useEffect(() => {
    if (search.checkout !== "success") return;
    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      const { data } = await supabase.rpc("my_access_state").single();
      if (cancelled) return;
      if (data?.has_access) {
        // The auth guard caches its answer for a minute. Without evicting it,
        // the student lands on a dashboard still wearing the paywall they just
        // paid to remove.
        invalidateGuardState(queryClient);
        toast.success("You're all set — welcome to Anglia Educate.");
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
  }, [search.checkout, navigate, queryClient]);

  useEffect(() => {
    if (search.checkout === "cancelled") toast.info("Checkout cancelled — nothing was charged.");
  }, [search.checkout]);

  const payNow = async () => {
    if (!selectedPkg) return;
    setRedirecting(true);
    try {
      await startCheckout({ tier: selectedPkg.tier, returnTo: "onboarding" });
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
      <div className="premium-card rounded-3xl p-10 text-center rise-in">
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

  // Wait for the plan-state answer before choosing a branch. Flashing the shop
  // at a student who only paused is the exact mistake this page guards against.
  if (planStatePending) {
    return (
      <div className="premium-card rounded-3xl p-10 text-center">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  // Dormant plan: this page must not offer to sell anything — not Checkout, and
  // not "ask a parent to pay" either, since a parent buying on top creates the
  // same duplicate subscription. Resume is the whole answer, and it's free.
  if (resumable) {
    return (
      <div className="premium-card rounded-3xl p-6 sm:p-8 rise-in space-y-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight mb-1">
            Your plan is on hold
          </h1>
          <p className="text-sm text-muted-foreground">
            You already have a plan with us — it's paused or set to end, not gone. Resume it and
            your dashboard, progress and history come straight back. There's nothing to buy again.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate({ to: "/billing" })}
          className="btn-premium w-full h-12 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2"
        >
          <CreditCard className="w-4 h-4" /> Go to Billing and resume
        </button>
        <button
          type="button"
          onClick={signOut}
          className="w-full text-xs text-muted-foreground hover:text-foreground"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="premium-card rounded-3xl p-6 sm:p-8 rise-in">
        <h1 className="font-display text-2xl font-semibold tracking-tight mb-1">Your plan</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Built from the subjects you're studying with us. Choose how often you'd like to pay — your
          dashboard unlocks straight away, and you can cancel anytime.
        </p>

        {loading ? (
          <div className="py-10 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Summary — what they're buying, read from their enrolments. */}
            <div className="rounded-2xl border border-border bg-secondary/50 p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <GraduationCap className="w-3.5 h-3.5" />
                  {labelFor(LEVELS, level)} · {subjectCount}{" "}
                  {subjectCount === 1 ? "subject" : "subjects"}
                </div>
                <button
                  type="button"
                  onClick={() => navigate({ to: "/onboarding/subjects" })}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="w-3 h-3" /> Edit subjects
                </button>
              </div>
              <ul className="space-y-1.5">
                {enrolments.map((e) => (
                  <li key={e.subject} className="flex items-center gap-2 text-sm">
                    <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="font-medium">{labelFor(SUBJECTS, e.subject)}</span>
                    <span className="text-xs text-muted-foreground">
                      {labelFor(BOARDS, e.board)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Cadence — the one thing left to choose. */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              {CADENCES.map((c) => {
                const pkg = packageFor(c.key);
                const on = cadence === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setCadence(c.key)}
                    className={`relative rounded-xl border p-3 text-center transition ${
                      on
                        ? "border-primary bg-primary/[0.07] ring-2 ring-primary/15 shadow-sm"
                        : "border-border bg-background hover:border-primary/50 hover:-translate-y-0.5 hover:shadow-sm"
                    }`}
                  >
                    {c.note && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary-foreground">
                        {c.note}
                      </span>
                    )}
                    <div className="text-xs font-semibold">{c.label}</div>
                    <div className="mt-1 font-display font-bold">
                      {pkg ? formatPence(pkg.price_pence) : "—"}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{c.unit}</div>
                  </button>
                );
              })}
            </div>

            {/* The compiled price. */}
            <div className="mt-4 flex items-end justify-between rounded-2xl border border-primary/20 bg-primary/[0.04] p-4">
              <div>
                <div className="text-xs text-muted-foreground">Total</div>
                <div className="font-display text-2xl font-bold">
                  {selectedPkg ? formatPence(selectedPkg.price_pence) : "—"}
                  <span className="text-sm font-medium text-muted-foreground"> {selectedUnit}</span>
                </div>
              </div>
              {selectedPkg?.description && (
                <p className="text-xs text-muted-foreground text-right max-w-[45%]">
                  {selectedPkg.description}
                </p>
              )}
            </div>

            {!selectedPkg && (
              <p className="mt-3 text-xs text-rose-600">
                We couldn't find a matching plan for your subjects. Please get in touch and we'll
                sort it out.
              </p>
            )}

            <button
              type="button"
              onClick={payNow}
              disabled={!selectedPkg || redirecting}
              className="btn-premium mt-5 w-full h-12 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2"
            >
              {redirecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Taking you to Stripe…
                </>
              ) : (
                <>
                  <CreditCard className="w-4 h-4" /> Pay{" "}
                  {selectedPkg ? formatPence(selectedPkg.price_pence) : ""} {selectedUnit}
                </>
              )}
            </button>
            <p className="mt-3 text-[11px] text-muted-foreground text-center">
              Payments are handled by Stripe. We never see or store your card details.
            </p>
          </>
        )}
      </div>

      <div className="premium-card rounded-3xl p-6 sm:p-8 rise-in">
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
              className="flex-1 h-11 rounded-xl bg-background border border-border px-3.5 text-sm transition focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
            />
            <button
              type="button"
              onClick={inviteParent}
              disabled={inviting}
              className="h-11 px-4 rounded-xl border border-border text-sm font-semibold hover:border-primary/40 hover:text-primary transition disabled:opacity-50 shrink-0"
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
