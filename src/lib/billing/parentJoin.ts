import { supabase } from "@/integrations/supabase/client";
import type { Cadence } from "@/lib/billing/entitlements";
import type { LevelV } from "@/lib/curriculum/taxonomy";

/**
 * "My parent is paying": a one-time link a student hands their parent.
 *
 * The student's plan page makes the link (`createParentJoinLink`) and shows it
 * as a QR code. The parent opens it on their own phone at /parent-join, makes
 * a parent account or logs in, is linked to the child (`redeemParentJoinLink`)
 * and goes to Stripe with the child's plan. Each link works once, for one
 * parent, for 24 hours; making a new one kills the old. The rules live in the
 * database (20261117120000_parent_join_links): nothing here is trusted.
 */

export const PARENT_JOIN_PATH = "/parent-join";

/** The plan a link is for: what the parent is shown and pays for. */
export interface ParentJoinPlan {
  student_name: string;
  level: LevelV | null;
  subjects: { subject: string; board: string | null }[];
  cadence: Cadence;
}

export type ParentJoinPeek =
  | ({ status: "ok"; joined: boolean } & ParentJoinPlan)
  | { status: "used" | "expired" | "not_found" };

export type ParentJoinRedeem =
  | ({ status: "linked" | "already_linked"; student_id: string } & ParentJoinPlan)
  | { status: "used" | "expired" | "not_found" | "not_a_parent" };

export type ParentJoinStatus =
  | { status: "waiting"; expires_at: string }
  | { status: "joined"; parent_name: string | null }
  | { status: "expired" | "not_found" };

/** The address the QR code holds. */
export function parentJoinUrl(token: string, origin = window.location.origin) {
  const url = new URL(PARENT_JOIN_PATH, origin);
  url.searchParams.set("t", token);
  return url.toString();
}

export async function createParentJoinLink(cadence: Cadence) {
  const { data, error } = await supabase.rpc("create_parent_join_link", { _cadence: cadence });
  if (error) throw new Error(error.message);
  return data as unknown as { token: string; expires_at: string };
}

export async function peekParentJoinLink(token: string) {
  const { data, error } = await supabase.rpc("peek_parent_join_link", { _token: token });
  if (error) throw new Error(error.message);
  return data as unknown as ParentJoinPeek;
}

export async function redeemParentJoinLink(token: string) {
  const { data, error } = await supabase.rpc("redeem_parent_join_link", { _token: token });
  if (error) throw new Error(error.message);
  const result = data as unknown as ParentJoinRedeem;
  // Linked: the link has done its job, so this browser stops holding it.
  if (result.status === "linked" || result.status === "already_linked") forgetParentJoin();
  return result;
}

export async function parentJoinLinkStatus(token: string) {
  const { data, error } = await supabase.rpc("parent_join_link_status", { _token: token });
  if (error) throw new Error(error.message);
  return data as unknown as ParentJoinStatus;
}

// The token waits in this browser while the parent makes an account: email
// sign-up stops for a code, and Google or Microsoft leave the site and come
// back to /auth. It is dropped from the address bar as soon as it is read, so
// it isn't left in the history or sent on as a referrer, and from storage once
// it has linked the parent or they leave without linking.
const KEY = "parent-join";
const MAX_AGE_MS = 24 * 60 * 60_000;

export function rememberParentJoin(token: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ token, at: Date.now() }));
  } catch {
    /* Storage unavailable: the link still works in this tab, from the URL. */
  }
}

export function readParentJoin(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { token, at } = JSON.parse(raw) as { token?: string; at?: number };
    if (!token || !at || Date.now() - at > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

export function forgetParentJoin() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}
