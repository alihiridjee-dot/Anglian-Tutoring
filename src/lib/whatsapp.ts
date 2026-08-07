/**
 * The one place that knows Anglia Educate's WhatsApp number.
 *
 * Two different things need it and they must not drift: the floating button on
 * the marketing pages, and the "carry on in WhatsApp" hand-off at the end of the
 * demo chat. A visitor who is passed between the two and lands on a different
 * number has been dropped.
 *
 * The number is public by nature — it is printed on the site — so it lives in a
 * `VITE_` variable and ships in the bundle. The *API* credentials that send
 * messages programmatically are a separate, server-only concern and never
 * appear here; see `whatsappLead.functions.ts`.
 */

/** E.164 without the leading `+`, which is the form wa.me expects. */
const FALLBACK_NUMBER = "447530863009";

export const WHATSAPP_NUMBER: string =
  import.meta.env.VITE_WHATSAPP_NUMBER?.replace(/\D/g, "") || FALLBACK_NUMBER;

/** Human-readable, for printing next to the link. */
export const WHATSAPP_DISPLAY = "+44 7530 863009";

/**
 * A wa.me deep link, optionally pre-filled.
 *
 * Pre-filling matters for the sales hand-off: it opens WhatsApp with the
 * visitor's own question already typed, so the thread that reaches the team
 * carries the context instead of an empty "hi". It also opens the 24-hour
 * window from their side, which is what lets the team reply freely afterwards.
 */
export function whatsappLink(prefill?: string): string {
  const base = `https://wa.me/${WHATSAPP_NUMBER}`;
  const text = prefill?.trim();
  return text ? `${base}?text=${encodeURIComponent(text.slice(0, 900))}` : base;
}
