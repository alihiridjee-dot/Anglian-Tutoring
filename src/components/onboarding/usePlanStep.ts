import { usePageRestore } from "@/hooks/usePageRestore";
import { type useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { type QueryClient } from "@tanstack/react-query";
import { type User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { invalidateGuardState } from "@/lib/auth/guardState";
import { usePackages, useOwnPlanState } from "@/hooks/data/useBilling";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { INVITE_MESSAGE, useInviteParent, type InviteOutcome } from "@/hooks/data/useParentLinks";
import { startCheckout } from "@/lib/billing/billing";
import { forgetTrialCode, readTrialCode } from "@/lib/billing/trialCode";
import {
  BEST_VALUE_CADENCE,
  BEST_VALUE_LABEL,
  CADENCES as BILLING_CADENCES,
  type Cadence,
} from "@/lib/billing/entitlements";

export type SearchParams = { checkout?: "success" | "cancelled" };

/**
 * Billing cadences, in display order. Each maps to the `${key}_${n}` tiers. The
 * "Best value" note comes from the one shared choice, so this page can't
 * disagree with the landing page about which cadence it is.
 */
export const CADENCES: { key: Cadence; label: string; unit: string; note?: string }[] =
  BILLING_CADENCES.map((c) => ({
    ...c,
    note: c.key === BEST_VALUE_CADENCE ? BEST_VALUE_LABEL : undefined,
  }));

/**
 * The paywall's working state: the one price built from the student's
 * enrolments, whether they already hold a dormant plan, the wait for Stripe's
 * webhook after Checkout, and the two ways to pay.
 */
export function usePlanStep({
  navigate,
  user,
  queryClient,
  search,
}: {
  navigate: ReturnType<typeof useNavigate>;
  user: User;
  queryClient: QueryClient;
  search: SearchParams;
}) {
  const { enrolments, level, inviteCode, loading: loadingEnrolments } = useEnrolments();
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
  const {
    resumable,
    paymentOverdue,
    isPending: planStatePending,
    error: planStateError,
    refetch: refetchPlanState,
  } = useOwnPlanState();

  // Preselect the cadence the student picked on the pricing page (stashed in
  // auth metadata at signup as e.g. "weekly_2"); otherwise keep monthly.
  const [cadence, setCadence] = useState<Cadence>(() => {
    const intended = user.user_metadata?.intended_tier as string | undefined;
    return CADENCES.find((c) => intended?.startsWith(c.key))?.key ?? "monthly";
  });
  const [redirecting, setRedirecting] = useState(false);
  // Back from Stripe restores this page as it was left — spinner and all.
  usePageRestore(() => setRedirecting(false));
  // The confirmation poll ran out. `confirmRound` restarts it.
  const [confirmDelayed, setConfirmDelayed] = useState(false);
  const [confirmRound, setConfirmRound] = useState(0);
  const [parentEmail, setParentEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  // What invite_parent_by_email actually did. It sends no email: an existing
  // parent gets a request in their account, and anyone else needs the code.
  const [inviteOutcome, setInviteOutcome] = useState<InviteOutcome | null>(null);
  const invite = useInviteParent();
  // A code from the emailed link, read after mount so the server render and
  // the first client render agree.
  const [trialCode, setTrialCode] = useState("");
  useEffect(() => setTrialCode(readTrialCode()), []);

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
        forgetTrialCode();
        // The auth guard caches its answer for a minute. Without evicting it,
        // the student lands on a dashboard still wearing the paywall they just
        // paid to remove.
        invalidateGuardState(queryClient);
        toast.success("You're all set — welcome to Anglia Educate.");
        navigate({ to: "/dashboard" });
        return;
      }
      if (++attempts < 15) setTimeout(poll, 1000);
      // Out of attempts. This used to toast "refresh in a moment" and leave
      // "Confirming your payment… Don't close this tab" on screen for ever,
      // with nothing to press.
      else if (!cancelled) setConfirmDelayed(true);
    };
    setConfirmDelayed(false);
    poll();
    return () => {
      cancelled = true;
    };
  }, [search.checkout, navigate, queryClient, confirmRound]);

  useEffect(() => {
    if (search.checkout === "cancelled") toast.info("Checkout cancelled — nothing was charged.");
  }, [search.checkout]);

  const payNow = async () => {
    if (!selectedPkg) return;
    setRedirecting(true);
    try {
      await startCheckout({ tier: selectedPkg.tier, returnTo: "onboarding", trialCode });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open checkout — try again.");
      setRedirecting(false);
    }
  };

  const inviteParent = async () => {
    if (!parentEmail.trim()) return toast.error("Enter your parent's email first.");
    setInviting(true);
    try {
      const outcome = await invite.mutateAsync(parentEmail.trim().toLowerCase());
      setInviteOutcome(outcome);
      if (outcome === "invited") toast.success(INVITE_MESSAGE.invited);
      else toast.info(INVITE_MESSAGE[outcome]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send that invite.");
    } finally {
      setInviting(false);
    }
  };

  return {
    enrolments,
    level,
    loading,
    subjectCount,
    resumable,
    paymentOverdue,
    planStatePending,
    planStateError,
    refetchPlanState,
    cadence,
    setCadence,
    redirecting,
    confirmDelayed,
    setConfirmRound,
    parentEmail,
    setParentEmail,
    inviting,
    inviteOutcome,
    setInviteOutcome,
    inviteCode,
    packageFor,
    trialCode,
    setTrialCode,
    selectedPkg,
    selectedUnit,
    payNow,
    inviteParent,
  };
}

export type PlanStepState = ReturnType<typeof usePlanStep>;
