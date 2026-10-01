import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Sign-up with Google or Microsoft: what the visitor chose on our form,
 * carried across the round trip to the provider and back.
 *
 * `signUp` stores the role, a parent's invite code and the plan picked on the
 * pricing page as sign-up metadata. `signInWithOAuth` has no such field, and
 * the provider sends back only its own profile, so the choices wait here.
 *
 * Nothing here is trusted. Whether the account may become a parent is decided
 * by `claim_parent_role()`, the link by `link_child_by_code()`, and the plan
 * fields only prefill onboarding, exactly as the `signUp` metadata does.
 */

export type SsoProvider = "google" | "azure";

export interface SsoIntent {
  role: "student" | "parent";
  inviteCode: string | null;
  tier: string | null;
  level: string | null;
  subjects: string | null;
  board: string | null;
}

const KEY = "sso-sign-up";
/** The same window `claim_parent_role()` allows a new account. */
const MAX_AGE_MS = 30 * 60_000;

export function rememberSsoIntent(intent: SsoIntent) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...intent, at: Date.now() }));
  } catch {
    /* Storage unavailable: the account is made as a student, as with no intent. */
  }
}

/** Read and forget in one go, so a choice is applied at most once. */
function takeSsoIntent(): SsoIntent | null {
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    if (!raw) return null;
    const { at, ...intent } = JSON.parse(raw) as SsoIntent & { at: number };
    return Date.now() - at <= MAX_AGE_MS ? intent : null;
  } catch {
    return null;
  }
}

/** How each outcome of claiming the parent role or linking a child reads. */
const NOT_A_NEW_ACCOUNT =
  "This account is already set up as a student, so it can't become a parent account. Sign up as a parent with a different email.";
const LINK_MESSAGE: Record<string, string> = {
  not_found: "No student matches that invite code. You can add it later on your Parents page.",
  rate_limited: "Too many invite code attempts. Add it later on your Parents page.",
};

/**
 * Apply a remembered sign-up choice to the account the provider just signed
 * in. Safe to call on every arrival at /auth: with nothing remembered it does
 * nothing.
 */
export async function finishSsoSignUp(): Promise<void> {
  const intent = takeSsoIntent();
  if (!intent) return;

  const hints = Object.fromEntries(
    Object.entries({
      intended_tier: intent.tier,
      intended_level: intent.level,
      intended_subjects: intent.subjects,
      intended_board: intent.board,
    }).filter(([, v]) => v),
  );
  if (Object.keys(hints).length) await supabase.auth.updateUser({ data: hints });

  if (intent.role !== "parent") return;

  const claim = await supabase.rpc("claim_parent_role");
  const status = (claim.data as { status?: string } | null)?.status;
  if (claim.error || (status !== "claimed" && status !== "already_parent")) {
    toast.error(claim.error ? claim.error.message : NOT_A_NEW_ACCOUNT);
    return;
  }

  if (!intent.inviteCode) return;
  const link = await supabase.rpc("link_child_by_code", { _code: intent.inviteCode });
  const result = link.data as { status?: string; student_name?: string } | null;
  if (link.error) toast.error(link.error.message);
  else if (result?.status === "linked") toast.success(`Linked to ${result.student_name}`);
  else if (result?.status && LINK_MESSAGE[result.status]) toast.error(LINK_MESSAGE[result.status]);
}

/**
 * The providers switched on in Supabase Auth right now. A button for one that
 * isn't would send the visitor to a raw Supabase error page, so the form shows
 * only these. Read from Auth's public settings, the same endpoint supabase-js
 * itself is configured against.
 */
export async function fetchEnabledSsoProviders(): Promise<SsoProvider[]> {
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
  });
  if (!res.ok) return [];
  const { external } = (await res.json()) as { external?: Record<string, boolean> };
  return (["google", "azure"] as const).filter((p) => external?.[p]);
}

/** A provider that refused or failed sends its reason back in the URL. */
export function readProviderError(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
  return params.get("error_description") ?? params.get("error");
}
