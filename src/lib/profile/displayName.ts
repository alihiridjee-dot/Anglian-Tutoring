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

/**
 * Characters that take no space or turn text around: zero-width spaces,
 * direction overrides, byte-order marks. A name made of them greets nobody
 * and can't be typed back. The two joiners emoji and some scripts need stay.
 */
const INVISIBLE = /[^\P{Cf}‌‍]/gu;
/** Something a reader can see: not a format character, a space or a mark alone. */
const VISIBLE = /[^\p{Cf}\p{Z}\p{M}\s]/u;

/** The name with its invisible characters gone, or "" if nothing visible is left. */
export function cleanName(raw: string | null | undefined): string {
  const name = (raw ?? "").replace(INVISIBLE, "").trim();
  return VISIBLE.test(name) ? name : "";
}

/**
 * True when what was typed reads as the name: case, spacing, invisible
 * characters and an accent typed either way aside. An empty name matches nothing.
 */
export function sameName(typed: string, name: string): boolean {
  const norm = (s: string) => cleanName(s).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
  const target = norm(name);
  return target !== "" && norm(typed) === target;
}

/** The first `count` characters as a reader sees them, so an emoji stays whole. */
function firstLetters(word: string, count: number): string {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const parts = [...new Intl.Segmenter().segment(word)].slice(0, count);
    return parts.map((p) => p.segment).join("");
  }
  return Array.from(word).slice(0, count).join("");
}

/** The name to greet someone by. */
export function resolveDisplayName(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string {
  const name = cleanName(displayName);
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
  const name = cleanName(displayName);
  if (name) {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return (firstLetters(words[0], 1) + firstLetters(words[words.length - 1], 1)).toUpperCase();
    }
    return firstLetters(words[0], 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}
