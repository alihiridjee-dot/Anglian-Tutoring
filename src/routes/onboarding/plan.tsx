import { useOnboardingUser } from "@/hooks/useOnboardingUser";
import { ErrorNote, Spinner } from "@/components/Shared";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, CreditCard } from "lucide-react";
import { useSignOut } from "@/hooks/useSignOut";
import { formatPence } from "@/lib/billing/billing";
import { usePlanStep, type SearchParams } from "@/components/onboarding/usePlanStep";
import {
  AskParentCard,
  CadencePicker,
  PaymentConfirming,
  PaymentStillConfirming,
  PlanOnHold,
  PlanSummary,
  PlanTotal,
} from "@/components/onboarding/PlanStepParts";

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
  const user = useOnboardingUser();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const signOut = useSignOut();

  const step = usePlanStep({ navigate, user, queryClient, search });
  const {
    loading,
    resumable,
    planStatePending,
    planStateError,
    refetchPlanState,
    redirecting,
    confirmDelayed,
    setConfirmRound,
    selectedPkg,
    selectedUnit,
    payNow,
  } = step;

  if (search.checkout === "success" && confirmDelayed) {
    return <PaymentStillConfirming onCheckAgain={() => setConfirmRound((n) => n + 1)} />;
  }

  if (search.checkout === "success") {
    return <PaymentConfirming />;
  }

  // Wait for the plan-state answer before choosing a branch. Flashing the shop
  // at a student who only paused is the exact mistake this page guards against.
  if (planStatePending) {
    return (
      <div className="pop-card p-10 text-center">
        <Spinner className="py-2" />
      </div>
    );
  }

  // "Couldn't read your plan" is not "you have no plan". Falling through to the
  // shop here is the double-billing case this page exists to prevent: a student
  // who only paused, offered Checkout because one request failed.
  if (planStateError) {
    return (
      <div className="premium-card rounded-3xl p-6 sm:p-8">
        <ErrorNote error={planStateError} onRetry={() => void refetchPlanState()} />
      </div>
    );
  }

  // Dormant plan: this page must not offer to sell anything — not Checkout, and
  // not "ask a parent to pay" either, since a parent buying on top creates the
  // same duplicate subscription. Resume is the whole answer, and it's free.
  if (resumable) {
    return <PlanOnHold onResume={() => navigate({ to: "/billing" })} onSignOut={signOut} />;
  }

  return (
    <div className="space-y-4">
      <div className="premium-card rounded-3xl p-6 sm:p-8 rise-in">
        <h1 className="font-display text-2xl font-bold tracking-tight mb-1">Your plan</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Built from the subjects you're studying with us. Choose how often you'd like to pay — your
          dashboard unlocks straight away, and you can cancel anytime.
        </p>

        {loading ? (
          <Spinner className="py-10" />
        ) : (
          <>
            <PlanSummary
              {...step}
              onEditSubjects={() => navigate({ to: "/onboarding/subjects" })}
            />

            <CadencePicker {...step} />

            <PlanTotal selectedPkg={selectedPkg} selectedUnit={selectedUnit} />

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

      <AskParentCard {...step} />

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
