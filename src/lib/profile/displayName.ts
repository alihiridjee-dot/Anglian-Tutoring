/**
 * How the app addresses a user, in one place.
 *
 * The greeting and the avatar initials used to derive themselves from the email
 * independently, which is why "test 1" showed up as "Welcome back, 123!" next to
 * a "12" avatar. Both now resolve through here, so a profile edit moves them
 * together and they can't drift apart again.
 *
 * The email stays as a fallback rather than a source: an account that has never
 * set a name still needs something to render.
 */

/** Turns "jamie.doe@x.com" into "Jamie.doe" — a last resort, not a name. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0];
  if (!local) return "there";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** The name to greet someone by. */
export function resolveDisplayName(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string {
  const name = displayName?.trim();
  if (name) return name;
  if (email) return nameFromEmail(email);
  return "there";
}

/**
 * Up to two letters for the avatar.
 *
 * Uses the initials of the first and last word when there's a real name
 * ("test 1" → "T1", "Jamie Doe" → "JD"), falling back to the first two
 * characters for a single word or an email.
 */
export function resolveInitials(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string {
  const name = displayName?.trim();
  if (name) {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    }
    return words[0].slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}
