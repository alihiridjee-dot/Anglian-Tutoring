/**
 * Field validators for the account forms.
 *
 * Deliberately dependency-free: the project carries no schema library, and
 * these forms are small enough that a validator is a pure
 * `(value) => string | null` — null meaning valid.
 *
 * Rules that also exist in the database are marked against their constraint.
 * The client copy exists to give a useful message before the round trip, never
 * as the enforcement: the database rejects the same input on its own.
 */

export type Validator<T = string> = (value: T) => string | null;

export const EMAIL_MAX = 320;
export const PASSWORD_MIN = 8;

/**
 * Mirrors the regex in `invite_parent_by_email` (and the length ceiling in the
 * `parent_link_invites_email_normalised` check), so the form rejects what the
 * database would reject rather than surfacing a raw SQL error.
 *
 * Intentionally permissive — the real proof that an address exists and belongs
 * to the person is the confirmation email, not a regex.
 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Normalised the same way the database stores it: trimmed and lowercased. */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export const validateEmail: Validator = (raw) => {
  const value = normaliseEmail(raw);
  if (!value) return "Email is required";
  if (value.length > EMAIL_MAX) return `Email must be ${EMAIL_MAX} characters or fewer`;
  if (!EMAIL_RE.test(value)) return "Enter a valid email address";
  return null;
};

export const validatePassword: Validator = (value) => {
  if (!value) return "Password is required";
  if (value.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters`;
  // Length is the whole rule for now. `supabase/config.toml` sets
  // hibp_enabled = true, but leaked-password protection is DISABLED on the live
  // project (confirmed via the security advisor, 2026-07-15) — so nothing is
  // currently checking new passwords against known breaches. Don't add a rule
  // here on the assumption the server catches it; turn the setting on instead.
  return null;
};

/**
 * Phone digits, stored as free text in `profiles.phone`.
 *
 * Kept loose on formatting (spaces, dashes, parens and a leading + all pass)
 * and strict only on digit count, because prescribing a shape is how a valid
 * international number gets wrongly rejected.
 */
export const validatePhone: Validator = (raw) => {
  const value = raw.trim();
  if (!value) return null; // Optional — clearing the field is how you remove it.
  if (!/^\+?[\d\s()-]+$/.test(value)) {
    return "Phone can only contain digits, spaces, brackets, hyphens and a leading +";
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return "That phone number looks too short";
  if (digits.length > 15) return "That phone number looks too long"; // E.164 ceiling.
  return null;
};

/** Runs validators in order and returns the first failure, or null. */
export function firstError<T>(value: T, ...validators: Validator<T>[]): string | null {
  for (const validate of validators) {
    const error = validate(value);
    if (error) return error;
  }
  return null;
}
