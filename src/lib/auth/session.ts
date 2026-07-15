import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Single source of truth for authentication state and the live/demo distinction.
 *
 * There are exactly two ways to be "signed in", and BOTH use a real, valid
 * Supabase session — there is no client-side bypass:
 *
 *   • "live"  — a normal authenticated user (student / parent / tutor).
 *   • "demo"  — the public sandbox. This is still a real Supabase session, but
 *               for a dedicated demo account (demo.student / demo.parent). Data
 *               isolation is enforced server-side by row-level security, NOT by
 *               the client flag below. The flag is only a UI hint (banners etc).
 *
 * Because demo mode is a real session, the route guard (which requires a valid
 * session) protects live and demo routes identically. A stale demo flag with no
 * session can never reach a protected page — the guard redirects to /auth.
 */

export type DemoRole = "student" | "parent";

/** Mutually-exclusive auth environments. */
export type AuthMode = "live" | "demo" | "anonymous";

export interface AuthSession {
  /** Which environment the current session belongs to. */
  mode: AuthMode;
  /** The underlying Supabase user (present for both "live" and "demo"). */
  user: User | null;
  /** True only inside the public demo sandbox. */
  isDemo: boolean;
  /** The demo persona being previewed, when `isDemo` is true. */
  demoRole: DemoRole | null;
}

const DEMO_FLAG_KEY = "studyhub:is-demo";
const DEMO_ROLE_KEY = "studyhub:demo-role";

function readDemoFlag(): boolean {
  return typeof window !== "undefined" && localStorage.getItem(DEMO_FLAG_KEY) === "true";
}

function readDemoRole(): DemoRole | null {
  if (typeof window === "undefined") return null;
  const r = localStorage.getItem(DEMO_ROLE_KEY);
  return r === "student" || r === "parent" ? r : null;
}

/** True when the local session is flagged as the demo sandbox (UI hint only). */
export function isDemoMode(): boolean {
  return readDemoFlag();
}

/** The demo persona currently being previewed, or null when not in demo mode. */
export function getDemoRole(): DemoRole | null {
  return readDemoFlag() ? readDemoRole() : null;
}

/** Flags the current session as the demo sandbox. Call after a demo sign-in. */
export function markDemoSession(role: DemoRole): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DEMO_FLAG_KEY, "true");
  localStorage.setItem(DEMO_ROLE_KEY, role);
}

/** Clears all demo markers (does not sign out — callers do that separately). */
export function clearDemoSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(DEMO_FLAG_KEY);
  localStorage.removeItem(DEMO_ROLE_KEY);
}

/**
 * Resolves the full, typed auth state by validating the Supabase session with
 * the server (getUser hits the auth API — it does not trust local storage alone).
 */
export async function getAuthSession(): Promise<AuthSession> {
  const { data } = await supabase.auth.getUser();
  const user = data.user ?? null;
  const isDemo = !!user && readDemoFlag();
  return {
    mode: !user ? "anonymous" : isDemo ? "demo" : "live",
    user,
    isDemo,
    demoRole: isDemo ? readDemoRole() : null,
  };
}
