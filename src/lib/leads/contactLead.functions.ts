import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requestAddresses, retryWait, takeTokens } from "@/lib/platform/rateLimit";
import { saveLead } from "./saveLead.server";

/**
 * The landing page's contact form: a visitor's enquiry, written to the CRM.
 *
 * This is a public, session-less endpoint — the same shape as `sendWhatsAppLead`
 * in the demo, and it carries the same two guards for the same reasons:
 *
 *   • A honeypot field (`website`). A real form never shows it and leaves it
 *     empty; the bots that fill every field they find will not. A filled trap
 *     gets the same cheerful answer a real submission does, because telling a
 *     bot it was spotted only teaches whoever wrote it to stop filling the field.
 *
 *   • A per-IP rate limit, because an anonymous caller could otherwise repeat
 *     the insert forever and the `leads` table has already collected SEO spam.
 *
 * This function is the only way in: the lead is written with the service role
 * (saveLead.server.ts), and the public INSERT grant that let callers skip both
 * guards is revoked. The table's CHECK constraints still bound every field, and
 * the validation below mirrors them exactly, so a value they would reject is
 * caught here with a message a human wrote rather than a raw Postgres error.
 */

// Bounds mirror the CHECK constraints on `leads` exactly.
const MAX = { name: 200, email: 320, phone: 40, message: 4000 } as const;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Enquiries one IP may submit per window. Generous for a person, tight for a script. */
const PER_IP = { limit: 4, windowMs: 10 * 60_000 };
/** Enquiries through one connecting address, which behind Cloudflare many visitors share. */
const PER_HOP = { limit: 30, windowMs: 10 * 60_000 };

export interface ContactInput {
  name: string;
  email: string;
  phone?: string | null;
  message: string;
  /**
   * Honeypot. A real form leaves this empty because it is never shown; the
   * bots that fill every field they find will not.
   */
  website?: string | null;
}

function clean(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}

function validate(input: ContactInput) {
  const name = clean(input?.name, MAX.name);
  const email = clean(input?.email, MAX.email).toLowerCase();
  const phone = clean(input?.phone, MAX.phone);
  const message = clean(input?.message, MAX.message);

  if (!name) throw new Error("Please tell us your name.");
  if (!EMAIL_RE.test(email)) throw new Error("That email address doesn't look right.");
  if (!message) throw new Error("Please tell us what you'd like to know.");

  return {
    name,
    email,
    phone: phone || null,
    message,
    trap: clean(input?.website, 200),
  };
}

export const submitContactLead = createServerFn({ method: "POST" })
  .inputValidator(validate)
  .handler(async ({ data }) => {
    // A filled honeypot gets the same answer a real submission does.
    if (data.trap) return { ok: true as const };

    const { visitor, hop } = requestAddresses(getRequest()?.headers);
    const gate = takeTokens([
      { key: `contact:${visitor}`, ...PER_IP },
      { key: `contact-hop:${hop}`, ...PER_HOP },
    ]);
    if (!gate.ok) {
      // Nothing was saved, so it must not read as though it arrived.
      throw new Error(
        `That didn't send: too many messages came in at once. Please try again in ${retryWait(gate.retryAfter)}, or email us directly.`,
      );
    }

    const lead = { name: data.name, email: data.email, phone: data.phone, message: data.message };

    const { error } = await saveLead(lead);
    if (error) {
      console.error("[contact] lead insert failed:", error);
      throw new Error("We couldn't send that just now. Please try again, or email us directly.");
    }

    return { ok: true as const };
  });
