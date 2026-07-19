import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Single source of truth for authentication state and the live/showcase split.
 *
 * These two are completely disjoint, and that is the whole point:
 *
 *   • "live"     — a normal authenticated user (student / parent / tutor),
 *                  holding a real, server-validated Supabase session. Every
 *                  /_authenticated/* route requires one.
 *   • "showcase" — the public marketing demo under /demo/*. There is NO account
 *                  and NO session behind it; it renders hardcoded fixtures only.
 *                  It lives outside the auth guard entirely.
 *
 * Showcase mode is derived from the URL, not from storage or a login. That means
 * it cannot be "left on" by a stale flag, cannot bleed into a real session, and
 * cannot be entered by anything other than navigating to /demo/*. There is no
 * demo account to seed, restrict, or accidentally sign into.
 */

export type DemoRole = "student" | "parent";

/** Mutually-exclusive auth environments. */
export type AuthMode = "live" | "anonymous";

export interface AuthSession {
  /** Which environment the current session belongs to. */
  mode: AuthMode;
  /** The underlying Supabase user, when signed in. */
  user: User | null;
}

/**
 * True while rendering the public showcase.
 *
 * Read from the pathname so it is synchronous (query functions call it before
 * fetching), reload-safe, and self-clearing the moment you navigate away.
 */
export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.pathname.startsWith("/demo");
}

/** The persona the showcase is previewing, or null outside the showcase. */
export function getDemoRole(): DemoRole | null {
  if (!isDemoMode()) return null;
  return window.location.pathname.startsWith("/demo/parent") ? "parent" : "student";
}

/**
 * The signed-in user's id from the locally cached session — no network call.
 *
 * Safe for data fetching: the id is only used to scope queries, and RLS
 * re-checks the JWT server-side on every request anyway. Use getAuthSession
 * instead when you need the session *validated* (route guards, auth flows).
 */
export async function getSessionUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/**
 * Resolves the auth state by validating the session with the server (getUser
 * hits the auth API — it does not trust local storage alone).
 */
export async function getAuthSession(): Promise<AuthSession> {
  const { data } = await supabase.auth.getUser();
  const user = data.user ?? null;
  return { mode: user ? "live" : "anonymous", user };
}
