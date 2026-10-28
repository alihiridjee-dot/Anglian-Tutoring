import { supabase } from "@/integrations/supabase/client";

/**
 * Signing up again with an email address that was never verified.
 *
 * GoTrue keeps the first attempt's account exactly as it was (its password and
 * its metadata) and only sends a new code, and handle_new_user ran once, on
 * that first attempt. So whoever types the code lands in the first attempt's
 * account: its role, its name, and a password they may not have chosen (a
 * parent after signing up as a student, unable to log in with the password
 * they just typed).
 *
 * Once the code is accepted, the account is made to match the form that sent
 * it. On an ordinary first sign-up nothing differs, and only the password call
 * goes out (GoTrue answers it with `same_password`).
 *
 * The code screen can also be reached by logging in to the unverified account
 * (after a reload, or "Back to log in"). The form's choices, never its
 * password, are kept for this tab (`rememberSignUp`) so that path settles the
 * account the same way.
 */

export interface SignUpChoice {
  /**
   * The password typed on the sign-up form. Null when the code screen came
   * from logging in: GoTrue has just checked the stored password, so it stays.
   */
  password: string | null;
  displayName: string;
  role: "student" | "parent";
  /** A parent's invite code, trimmed, or null. */
  inviteCode: string | null;
  tier: string | null;
  level: string | null;
  subjects: string | null;
  board: string | null;
}

/** The sign-up metadata, in the shape `signUp` stores and handle_new_user reads. */
export function signUpMetadata(choice: SignUpChoice) {
  return {
    display_name: choice.displayName,
    role: choice.role,
    parent_invite_code: choice.role === "parent" ? choice.inviteCode : null,
    // The plan the student picked on the pricing page. Stashed here so it
    // survives the email-verification round-trip and can seed the onboarding
    // steps. Every one of these stays editable there.
    intended_tier: choice.tier,
    intended_level: choice.level,
    intended_subjects: choice.subjects,
    intended_board: choice.board,
  };
}

type Meta = Record<string, unknown> | undefined;

/** The role handle_new_user gave the account, from the metadata it was given. */
function roleOf(meta: Meta): "student" | "parent" {
  return String(meta?.role ?? "").toLowerCase() === "parent" ? "parent" : "student";
}

/** Invite codes compare the way the database matches them: trimmed, upper case. */
function codeOf(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/** Where the account (made from `meta`) differs from the form the code came from. */
export function signUpDrift(choice: SignUpChoice, meta: Meta) {
  const wanted: Record<string, unknown> = signUpMetadata(choice);
  return {
    metadata: Object.keys(wanted).some((k) => (meta?.[k] ?? null) !== (wanted[k] ?? null)),
    displayName: String(meta?.display_name ?? "").trim() !== choice.displayName.trim(),
    role:
      roleOf(meta) !== choice.role ||
      (choice.role === "parent" && codeOf(meta?.parent_invite_code) !== codeOf(choice.inviteCode)),
  };
}

export interface SettleResult {
  /** False when the password on the form could not be saved. */
  passwordSaved: boolean;
  /** What linking the invite code said, when the role had to be settled first. */
  link: { status?: string; student_name?: string } | null;
}

/**
 * Make a just-verified account match the sign-up form. Never throws for a
 * refusal: verification has already succeeded, and the student goes on.
 */
export async function settleSignUp(
  choice: SignUpChoice,
  user: { id: string; user_metadata?: Meta },
  db: Pick<typeof supabase, "auth" | "from" | "rpc"> = supabase,
): Promise<SettleResult> {
  // The password first: it is the part that keeps anybody else out.
  let passwordSaved = true;
  if (choice.password !== null) {
    const pw = await db.auth.updateUser({ password: choice.password });
    passwordSaved = !pw.error || pw.error.code === "same_password";
  }

  const drift = signUpDrift(choice, user.user_metadata);
  if (drift.metadata) await db.auth.updateUser({ data: signUpMetadata(choice) });
  if (drift.displayName) {
    await db.from("profiles").update({ display_name: choice.displayName.trim() }).eq("id", user.id);
  }

  let link: SettleResult["link"] = null;
  if (drift.role) {
    const settled = await db.rpc("settle_sign_up_role", {
      _role: choice.role,
      _invite_code: choice.inviteCode ?? "",
    });
    const status = (settled.data as { status?: string } | null)?.status;
    if (!settled.error && status === "settled" && choice.role === "parent" && choice.inviteCode) {
      const res = await db.rpc("link_child_by_code", { _code: choice.inviteCode });
      link = res.error ? { status: "error" } : (res.data as SettleResult["link"]);
    }
  }
  return { passwordSaved, link };
}

/** What the sign-up form said, without the password. */
export type SavedSignUp = Omit<SignUpChoice, "password">;

const SAVED_KEY = "sign-up-choice";

function tabStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const emailKey = (email: string) => email.trim().toLowerCase();

/**
 * Keep the form's choices for this tab, never the password. sessionStorage: a
 * reload keeps it (a phone often reloads the tab on the way back from the mail
 * app), and it goes when the tab is closed.
 */
export function rememberSignUp(email: string, choice: SignUpChoice) {
  const { password: _password, ...saved } = choice;
  try {
    tabStorage()?.setItem(SAVED_KEY, JSON.stringify({ email: emailKey(email), saved }));
  } catch {
    /* Storage unavailable: logging in later verifies the account as it was made. */
  }
}

/**
 * The choices kept for this email, or null. Not forgotten here: the tab can
 * reload again before the code is typed. `forgetSignUp` clears them once the
 * email is verified.
 */
export function readSignUp(email: string): SavedSignUp | null {
  try {
    const raw = tabStorage()?.getItem(SAVED_KEY);
    if (!raw) return null;
    const { email: kept, saved } = JSON.parse(raw) as { email?: string; saved?: SavedSignUp };
    if (kept !== emailKey(email) || !saved) return null;
    if (saved.role !== "student" && saved.role !== "parent") return null;
    if (typeof saved.displayName !== "string") return null;
    return saved;
  } catch {
    return null;
  }
}

export function forgetSignUp() {
  try {
    tabStorage()?.removeItem(SAVED_KEY);
  } catch {
    /* Nothing to clear. */
  }
}
