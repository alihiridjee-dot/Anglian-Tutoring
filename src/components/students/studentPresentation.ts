import { isSubscriptionLive, type SubscriptionRow } from "@/lib/billing/billing";

/**
 * The small vocabulary the Students pages share: how a plan's state is named
 * and tinted, and how dates read. Kept together so the roster's plan column and
 * the record's header can't describe the same subscription two ways.
 */

export type PlanState = "live" | "ending" | "paused" | "lapsed" | "none";

export function planStateOf(sub: SubscriptionRow | null | undefined): PlanState {
  if (!sub) return "none";
  if (sub.status === "paused") return "paused";
  if (isSubscriptionLive(sub.status)) return sub.cancel_at_period_end ? "ending" : "live";
  return "lapsed";
}

export const PLAN_STATE_LABEL: Record<PlanState, string> = {
  live: "Active",
  ending: "Ending",
  paused: "Paused",
  lapsed: "Lapsed",
  none: "No plan",
};

export const PLAN_STATE_TINT: Record<PlanState, string> = {
  live: "tint-emerald",
  ending: "tint-amber",
  paused: "tint-amber",
  lapsed: "tint-rose",
  none: "tint-slate",
};

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  return formatDate(iso);
}

/** A percentage's tint: the same thresholds the grade predictor uses. */
export function scoreTint(pct: number | null | undefined): string {
  if (pct == null) return "tint-slate";
  if (pct >= 70) return "tint-emerald";
  if (pct >= 40) return "tint-amber";
  return "tint-rose";
}
