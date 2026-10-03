// Free-trial codes: their shape, and the email that delivers one.
//
// Pure — no Deno, no network — so it is tested from bun
// (src/lib/billing/trialCode.test.ts). stripe-checkout imports
// normaliseTrialCode and TRIAL_DAYS from here too, so both ends agree on what a code is.

/** Days of free access a trial code unlocks. */
export const TRIAL_DAYS = 14;

// No 0/O, 1/I/L: a code is read off a phone and typed on a laptop.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SHAPE = /^AE-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

/** "AE-K7QM-3XPD" from eight random bytes. */
export function makeTrialCode(bytes: Uint8Array): string {
  if (bytes.length < 8) throw new Error("makeTrialCode needs 8 random bytes.");
  const chars = Array.from(bytes.slice(0, 8), (b) => ALPHABET[b % ALPHABET.length]);
  return `AE-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/**
 * A code as typed, in the stored form — or null if it can't be one. Forgives
 * case, spaces and a missing dash, which is how codes arrive from a phone.
 */
export function normaliseTrialCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const bare = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // By length, not by prefix: a code's own eight characters can start "AE".
  const body = bare.length === 10 && bare.startsWith("AE") ? bare.slice(2) : bare;
  if (body.length !== 8) return null;
  const code = `AE-${body.slice(0, 4)}-${body.slice(4)}`;
  return SHAPE.test(code) ? code : null;
}

/**
 * The one address behind the many ways of writing it, for "one trial per
 * person": lower-cased, with any "+tag" dropped, and for Gmail the dots in the
 * name too (Gmail ignores them) and googlemail.com read as gmail.com. Without
 * this, name+1@gmail.com, n.a.m.e@gmail.com and so on each got a trial.
 *
 * Only for counting: the code is still sent to the address as typed.
 */
export function canonicalEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 1) return lower;
  let name = lower.slice(0, at).split("+")[0];
  let domain = lower.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") name = name.replace(/\./g, "");
  return `${name || lower.slice(0, at)}@${domain}`;
}

export interface Email {
  subject: string;
  text: string;
  html: string;
}

const BRAND = "Anglia Educate";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The email carrying a code. `appUrl` is the site's origin, no trailing slash. */
export function buildTrialEmail(code: string, appUrl: string): Email {
  const link = `${appUrl}/auth?mode=signup&trial=${encodeURIComponent(code)}`;
  const subject = `Your ${BRAND} free-trial code`;
  const before = [`Hi,`, `Here's your code for ${TRIAL_DAYS} days free:`];
  const after = [
    `Create your account, choose your subjects, and enter the code when you pick a plan. The link below fills it in for you.`,
    `We'll ask for a card, but nothing is taken for ${TRIAL_DAYS} days. Cancel before then and you won't pay anything.`,
    `The code works once.`,
  ];

  const p = (s: string) => `<p style="margin:0 0 14px">${escapeHtml(s)}</p>`;
  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c2333;max-width:560px">`,
    ...before.map(p),
    `<p style="margin:0 0 18px;font-size:24px;font-weight:700;letter-spacing:2px;font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(code)}</p>`,
    ...after.map(p),
    `<p style="margin:6px 0 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#1c2333;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Start my free trial</a></p>`,
    `<p style="margin:24px 0 0;color:#5b6475;font-size:13px">${BRAND}</p>`,
    `</div>`,
  ].join("");

  const text = [...before, code, ...after, `Start here: ${link}`, BRAND].join("\n\n");
  return { subject, text, html };
}
