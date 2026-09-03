import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { takeToken } from "@/lib/rateLimit";

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
 * The insert goes through the anon key so the `leads public insert` RLS policy
 * still validates every field — the server is not a reason to skip RLS. The
 * validation below mirrors that policy's CHECK bounds exactly, so a value the
 * policy would reject is caught here with a message a human wrote rather than a
 * raw Postgres constraint error.
 */

// Bounds mirror the CHECK in the `leads public insert` policy exactly.
const MAX = { name: 200, email: 320, phone: 40, message: 4000 } as const;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Enquiries one IP may submit per window. Generous for a person, tight for a script. */
const PER_IP = { limit: 4, windowMs: 10 * 60_000 };

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

/**
 * Best available client identifier. Behind Vercel this is a real client IP;
 * behind nothing it may be empty, in which case every anonymous caller shares
 * one bucket — deliberately the strict direction to fail in.
 */
function clientKey(): string {
  const headers = getRequest()?.headers;
  const forwarded = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers?.get("x-real-ip")?.trim() || "unknown";
}

/** Anon client, built per request so nothing can carry a session between callers. */
function anonClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

export const submitContactLead = createServerFn({ method: "POST" })
  .inputValidator(validate)
  .handler(async ({ data }) => {
    // A filled honeypot gets the same answer a real submission does.
    if (data.trap) return { ok: true as const };

    const gate = takeToken(`contact:${clientKey()}`, PER_IP.limit, PER_IP.windowMs);
    if (!gate.ok) {
      throw new Error("We've got your message — give us a moment to reply before sending more.");
    }

    const lead = { name: data.name, email: data.email, phone: data.phone, message: data.message };

    const { error } = await anonClient().from("leads").insert(lead);
    if (error) {
      console.error("[contact] lead insert failed:", error.message);
      throw new Error("We couldn't send that just now. Please try again, or email us directly.");
    }

    return { ok: true as const };
  });
