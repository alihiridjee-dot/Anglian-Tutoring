import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { invalidateGuardState } from "@/lib/auth/guardState";
import { isDemoMode, getSessionUserId } from "@/lib/auth/session";
import {
  fetchInvoices,
  manageSubscription,
  addSubjects,
  removeSubjects,
  changeCadence,
  resolvePackagesForLevel,
  type Invoice,
  type PackageRow,
  type SubscriptionRow,
} from "@/lib/billing/billing";

/** All billing reads sit under this prefix, so one invalidate refreshes it. */
export const BILLING_KEY = ["billing"] as const;

/**
 * Active, purchasable plans in display order, narrowed to one student's level.
 *
 * A tier may carry a level-specific price alongside the general one, so the
 * raw table can hold two rows per tier. Pass the level of the student being
 * shopped for and they see exactly one card per tier; omit it and only the
 * general ladder is offered, which is the right default when the level isn't
 * known yet.
 */
export function usePackages(level?: string | null) {
  const raw = useRawPackages();
  return {
    ...raw,
    data: raw.data ? resolvePackagesForLevel(raw.data, level) : raw.data,
  };
}

/**
 * Every active row, including both the general and level-specific prices for a
 * tier — so it can hold two rows per tier and is not safe to render directly.
 *
 * Only for callers that price for several students at once (the parent billing
 * tab, where each child may sit a different level); resolve per student with
 * resolvePackagesForLevel before display.
 */
export function useRawPackages() {
  return useQuery({
    queryKey: [...BILLING_KEY, "packages"],
    queryFn: async (): Promise<PackageRow[]> => {
      const { data, error } = await supabase
        .from("packages")
        .select("id, tier, name, description, price_pence, billing_interval, level")
        .eq("active", true)
        .order("sort_order");
      if (error) throw new Error(error.message);
      return (data ?? []) as PackageRow[];
    },
    staleTime: 1000 * 60 * 10,
  });
}

/**
 * Exam level per student id, for pricing a group of children at once. Anything
 * RLS hides simply comes back absent, which resolves to the general ladder.
 */
export function useStudentLevels(studentIds: string[]) {
  return useQuery({
    enabled: studentIds.length > 0,
    queryKey: [...BILLING_KEY, "student-levels", [...studentIds].sort()],
    queryFn: async (): Promise<Record<string, string | null>> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, level")
        .in("id", studentIds);
      if (error) throw new Error(error.message);
      return Object.fromEntries((data ?? []).map((r) => [r.id, r.level]));
    },
    staleTime: 1000 * 60 * 10,
  });
}

/**
 * Subscriptions covering the given students. RLS lets the payer, the student,
 * and any linked parent read a row, so this works from both the student's
 * billing page (own id) and the parent dashboard (children's ids).
 */
export function useSubscriptions(studentIds: string[]) {
  return useQuery({
    queryKey: [...BILLING_KEY, "subscriptions", [...studentIds].sort()],
    queryFn: async (): Promise<SubscriptionRow[]> => {
      if (studentIds.length === 0) return [];
      const { data, error } = await supabase
        .from("subscriptions")
        .select(
          "user_id, student_id, status, plan, current_period_end, cancel_at_period_end, stripe_subscription_id",
        )
        .in("student_id", studentIds);
      if (error) throw new Error(error.message);
      return (data ?? []) as SubscriptionRow[];
    },
    enabled: !isDemoMode() && studentIds.length > 0,
  });
}

/**
 * The signed-in student's own plan, and whether it is merely dormant.
 *
 * `resumable` is the one that matters: a paused plan (or one running to a
 * period end) still exists in Stripe, so the way back in is Resume — free, and
 * instant. Offering Checkout there sells a SECOND subscription on top, and
 * because the webhook upserts subscriptions on student_id the new row silently
 * overwrites the old while the first keeps billing. Every surface that reacts to
 * "no access" must ask this before it says the word "subscribe".
 *
 * The server refuses that purchase too (assertNoLiveSubscription); this is what
 * stops the app from offering it in the first place.
 */
export function useOwnPlanState() {
  const query = useQuery({
    queryKey: [...BILLING_KEY, "own-plan"],
    enabled: !isDemoMode(),
    queryFn: async () => {
      const uid = await getSessionUserId();
      if (!uid) return null;
      const { data, error } = await supabase
        .from("subscriptions")
        .select("status, cancel_at_period_end, current_period_end")
        .eq("student_id", uid)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },
  });

  const sub = query.data ?? null;
  return {
    ...query,
    sub,
    /** A dormant plan that Resume brings back — never a reason to buy again. */
    resumable: !!sub && (sub.status === "paused" || sub.cancel_at_period_end),
    /** No plan has ever existed for this student, so Checkout is correct. */
    neverSubscribed: !query.isPending && sub === null,
  };
}

/** The signed-in payer's Stripe payment history. */
export function useInvoices(enabled = true) {
  return useQuery({
    queryKey: [...BILLING_KEY, "invoices"],
    queryFn: (): Promise<Invoice[]> => fetchInvoices(),
    enabled: enabled && !isDemoMode(),
    staleTime: 1000 * 60 * 5,
  });
}

/** Pause / resume / cancel a subscription the caller manages. */
export function useManageSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      action,
      studentId,
    }: {
      action: "cancel" | "pause" | "resume";
      studentId: string;
    }) => manageSubscription(action, studentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BILLING_KEY });
      // Pausing, resuming, cancelling and subject changes all move the access
      // state the route guard caches — evict it or the paywall lags a minute
      // behind what the student just did.
      invalidateGuardState(qc);
    },
  });
}

/**
 * Add subject(s) to a live plan. On success both billing (plan/invoices) and the
 * user's enrolment change, so refresh both caches — the curriculum unlocks the
 * new subject the moment enrolment reloads.
 */
export function useAddSubjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      studentId,
      subjects,
    }: {
      studentId: string;
      subjects: { subject: string; board: string }[];
    }) => addSubjects(studentId, subjects),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BILLING_KEY });
      // Pausing, resuming, cancelling and subject changes all move the access
      // state the route guard caches — evict it or the paywall lags a minute
      // behind what the student just did.
      invalidateGuardState(qc);
      qc.invalidateQueries({ queryKey: ["user-enrolments-and-profile"] });
      qc.invalidateQueries({ queryKey: ["parent-links"] });
      // The parent tab reads a child's enrolment under this key; without it the
      // card would keep offering a subject that was just added.
      qc.invalidateQueries({ queryKey: ["child-progress"] });
    },
  });
}

/**
 * Live price for switching to a cadence, straight from Stripe's upcoming
 * invoice. A query rather than a mutation because it mutates nothing — but with
 * no caching, since the amount depends on how far into the period they are.
 */
export function useCadenceQuote(studentId: string | null, cadence: string | null) {
  return useQuery({
    enabled: !!studentId && !!cadence && !isDemoMode(),
    queryKey: [...BILLING_KEY, "cadence-quote", studentId, cadence],
    queryFn: () => changeCadence(studentId!, cadence!, { preview: true }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Apply a cadence switch to the existing subscription (prorated by Stripe). */
export function useChangeCadence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, cadence }: { studentId: string; cadence: string }) =>
      changeCadence(studentId, cadence),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BILLING_KEY });
      // Pausing, resuming, cancelling and subject changes all move the access
      // state the route guard caches — evict it or the paywall lags a minute
      // behind what the student just did.
      invalidateGuardState(qc);
      qc.invalidateQueries({ queryKey: ["user-enrolments-and-profile"] });
    },
  });
}

/**
 * Drop subject(s) from a live plan. Invalidates the same caches as adding —
 * the plan tier, the enrolment, and the parent's child list all move — plus the
 * child-progress enrolments the parent billing tab reads, so a removal doesn't
 * leave a stale subject offered back on the card that just removed it.
 */
export function useRemoveSubjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, subjects }: { studentId: string; subjects: string[] }) =>
      removeSubjects(studentId, subjects),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BILLING_KEY });
      // Pausing, resuming, cancelling and subject changes all move the access
      // state the route guard caches — evict it or the paywall lags a minute
      // behind what the student just did.
      invalidateGuardState(qc);
      qc.invalidateQueries({ queryKey: ["user-enrolments-and-profile"] });
      qc.invalidateQueries({ queryKey: ["parent-links"] });
      qc.invalidateQueries({ queryKey: ["child-progress"] });
    },
  });
}

/** What Stripe Checkout appended to the URL it sent the browser back to. */
export type CheckoutStatus = "success" | "cancelled";

/** `validateSearch` for any page Checkout can return to. */
export function parseCheckoutStatus(value: unknown): CheckoutStatus | undefined {
  return value === "success" || value === "cancelled" ? value : undefined;
}

/** How often the plan is re-read while a payment is being confirmed. */
const CONFIRM_POLL_MS = 1500;
/** How long to keep looking before admitting the confirmation is late. */
const CONFIRM_WINDOW_MS = 30_000;

/**
 * The few seconds between paying and the app knowing about it.
 *
 * Coming back from Stripe means the payment succeeded, not that we know about
 * it yet — the webhook is a separate round trip, and it is the only writer of
 * `subscriptions`. The Billing page ignored that gap entirely: a student who had
 * just paid landed on "You don't have an active plan yet. Pick one below", with
 * the shop open beneath it, and until the webhook landed nothing on the server
 * would have stopped them buying a second plan.
 *
 * While `confirming` is true the caller must not offer Checkout. The plan is
 * re-read on a short timer until `confirmed` flips; past the window the state
 * becomes `delayed`, which the caller shows with `retry` — never the shop.
 *
 * @param confirmed Whether the plan being waited for is now visible. Pass
 *   `null` when that can't be told from here (a parent with several children):
 *   the window then simply runs out quietly instead of reporting a delay.
 * @param onDone Clear `?checkout=` from the URL. A reload must not replay this.
 */
export function useCheckoutReturn({
  status,
  confirmed,
  onDone,
}: {
  status: CheckoutStatus | undefined;
  confirmed: boolean | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<"idle" | "confirming" | "delayed">(
    status === "success" ? "confirming" : "idle",
  );
  const [round, setRound] = useState(0);

  // Read through refs so the timer below isn't torn down and restarted by
  // every render — it would never reach the end of its window.
  const confirmedRef = useRef(confirmed);
  confirmedRef.current = confirmed;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (status !== "cancelled") return;
    // The id makes it one toast, not one per effect run.
    toast.info("Checkout cancelled — nothing was charged.", { id: "checkout-cancelled" });
    onDoneRef.current();
  }, [status]);

  useEffect(() => {
    if (status !== "success" || phase !== "confirming") return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt < CONFIRM_WINDOW_MS) {
        void qc.invalidateQueries({ queryKey: BILLING_KEY });
        return;
      }
      clearInterval(timer);
      if (confirmedRef.current === null) {
        setPhase("idle");
        onDoneRef.current();
      } else {
        setPhase("delayed");
      }
    }, CONFIRM_POLL_MS);
    return () => clearInterval(timer);
  }, [status, phase, round, qc]);

  useEffect(() => {
    if (status !== "success" || !confirmed) return;
    // The route guard caches "no access" for a minute; without this the student
    // leaves Billing still wearing the paywall they just paid to remove.
    invalidateGuardState(qc);
    toast.success("Payment confirmed — your plan is active.", { id: "checkout-confirmed" });
    setPhase("idle");
    onDoneRef.current();
  }, [status, confirmed, qc]);

  return {
    /** Paid, not yet visible. Show a waiting state; do not offer Checkout. */
    confirming: status === "success" && phase === "confirming",
    /** Still not visible after the window. Offer `retry`, not the shop. */
    delayed: status === "success" && phase === "delayed",
    retry: () => {
      setPhase("confirming");
      setRound((n) => n + 1);
    },
  };
}
