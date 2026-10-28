import { isAuthRetryableFetchError, type User } from "@supabase/supabase-js";
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
  return isDemoPath(window.location.pathname);
}

/** True for a path inside the showcase. `isDemoMode` asks it of the current URL. */
export function isDemoPath(pathname: string): boolean {
  return pathname.startsWith("/demo");
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
 *
 * "The server said no" and "the server couldn't be reached" are different
 * answers. Both used to come back as `user: null`, so a student on school Wi-Fi
 * that dropped for a second was thrown to the login screen mid-lesson, holding
 * a perfectly good session. When the auth API is unreachable, the locally held
 * session stands in: it only decides which screen to draw, and RLS re-checks
 * the JWT on every request that follows regardless. A token the server has
 * actually rejected still resolves to anonymous.
 *
 * The guards ask this on every navigation, and asking the server each time put
 * a round trip in front of every click: on weak Wi-Fi the click looked dead
 * until the auth API answered. A token the server accepted in the last minute
 * is taken as still good, as the guard's own cached answers are (guardState).
 * A different token — signed out, someone else signed in, a refresh — is asked
 * about afresh, and RLS checks the token on every read regardless.
 */
const VALIDATED_FOR_MS = 60_000;
let validated: { token: string; userId: string; at: number } | null = null;

export async function getAuthSession(): Promise<AuthSession> {
  const { data: local } = await supabase.auth.getSession();
  const token = local.session?.access_token;
  const localUser = local.session?.user ?? null;
  if (
    token &&
    localUser &&
    validated?.token === token &&
    validated.userId === localUser.id &&
    Date.now() - validated.at < VALIDATED_FOR_MS
  ) {
    // The locally held user, not the one remembered: same person, but it
    // carries any change to the account made since (a new email, say).
    return { mode: "live", user: localUser };
  }

  const { data, error } = await supabase.auth.getUser();
  let user = data.user ?? null;
  if (user && token) validated = { token, userId: user.id, at: Date.now() };
  else validated = null;
  if (!user && error && isAuthRetryableFetchError(error)) {
    const { data: fallback } = await supabase.auth.getSession();
    user = fallback.session?.user ?? null;
  }
  return { mode: user ? "live" : "anonymous", user };
}
