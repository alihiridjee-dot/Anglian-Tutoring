import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDemoMode } from "@/lib/auth/session";
import {
  fetchInvoices,
  manageSubscription,
  addSubjects,
  type Invoice,
  type PackageRow,
  type SubscriptionRow,
} from "@/lib/billing";

/** All billing reads sit under this prefix, so one invalidate refreshes it. */
export const BILLING_KEY = ["billing"] as const;

/** Active, purchasable plans in display order. */
export function usePackages() {
  return useQuery({
    queryKey: [...BILLING_KEY, "packages"],
    queryFn: async (): Promise<PackageRow[]> => {
      const { data, error } = await supabase
        .from("packages")
        .select("id, tier, name, description, price_pence, billing_interval")
        .eq("active", true)
        .order("sort_order");
      if (error) throw new Error(error.message);
      return (data ?? []) as PackageRow[];
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
      qc.invalidateQueries({ queryKey: ["user-enrolments-and-profile"] });
      qc.invalidateQueries({ queryKey: ["parent-links"] });
    },
  });
}
