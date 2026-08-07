import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { takeToken } from "@/lib/rateLimit";

/**
 * The demo's sales chat: a visitor's question, delivered to the team's WhatsApp.
 *
 * This is the one endpoint in the app with no signed-in caller behind it. The
 * public showcase under /demo/* has no account by design, so `requireSupabaseAuth`
 * — which every other server function starts with — has nothing to check. That
 * changes what the function has to do for itself:
 *
 *   • It writes the lead to the database FIRST and notifies second. WhatsApp is
 *     someone else's API and it will be down at some point; a lead that reached
 *     the team's phone but not the CRM is recoverable, a lead that reached
 *     neither is a lost customer. The insert goes through the anon key so the
 *     `leads public insert` policy still validates it — the server is not a
 *     reason to skip RLS.
 *
 *   • It is rate limited per IP, because "send a WhatsApp message" is an action
 *     with a real cost attached and an anonymous caller could otherwise repeat
 *     it forever.
 *
 *   • It carries a global cap on sends, so even a distributed flood that defeats
 *     the per-IP limit bounds what it can spend. Leads still get written past
 *     the cap; only the notification is dropped, and the team can see them in
 *     the dashboard.
 *
 * Credentials live only here. `lib/whatsapp.ts` holds the public number for the
 * wa.me hand-off; the Cloud API token never leaves the server.
 */

// --- Shape of a lead ---------------------------------------------------------
// These bounds mirror the CHECK in the `leads public insert` policy exactly. A
// value the policy would reject is caught here with a message a human wrote,
// rather than surfacing as a Postgres constraint error.
const MAX = { name: 200, email: 320, phone: 40, message: 4000 } as const;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// --- Limits ------------------------------------------------------------------
/** Conversations one IP may submit per window. Generous for a person, tight for a script. */
const PER_IP = { limit: 3, windowMs: 10 * 60_000 };
/** Notifications this instance will send per hour, whatever the source. */
const GLOBAL = { limit: 60, windowMs: 60 * 60_000 };

const GRAPH_VERSION = "v21.0";

export interface LeadInput {
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

function validate(input: LeadInput) {
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

/**
 * WhatsApp template parameters may not contain newlines, tabs, or runs of four
 * or more spaces — the API rejects the whole message if they do. Free text from
 * a website form contains all three.
 */
function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

async function notifyWhatsApp(lead: {
  name: string;
  email: string;
  phone: string | null;
  message: string;
}): Promise<boolean> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const to = process.env.WHATSAPP_TO?.replace(/\D/g, "");

  // Not configured is a normal state, not an error: the lead is already saved
  // and the visitor is offered the wa.me hand-off either way. Shipping the chat
  // must not wait on a Meta business verification.
  if (!token || !phoneNumberId || !to) return false;

  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;

  const body = templateName
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en_GB" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: oneLine(lead.name, 60) },
                { type: "text", text: oneLine(lead.email, 80) },
                { type: "text", text: oneLine(lead.phone || "not given", 40) },
                { type: "text", text: oneLine(lead.message, 500) },
              ],
            },
          ],
        },
      }
    : {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          preview_url: false,
          body: [
            "🎓 New enquiry from the platform demo",
            "",
            `Name: ${lead.name}`,
            `Email: ${lead.email}`,
            `Phone: ${lead.phone ?? "not given"}`,
            "",
            lead.message,
          ].join("\n"),
        },
      };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      // Log the status, never the token or the visitor's details.
      console.error(`[whatsapp] notify failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[whatsapp] notify threw:", err instanceof Error ? err.message : "unknown");
    return false;
  }
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

export const sendWhatsAppLead = createServerFn({ method: "POST" })
  .inputValidator(validate)
  .handler(async ({ data }) => {
    // A filled honeypot gets the same answer a real submission does. Telling a
    // bot it was spotted only teaches whoever wrote it to stop filling the field.
    if (data.trap) return { ok: true as const, delivered: false };

    const gate = takeToken(clientKey(), PER_IP.limit, PER_IP.windowMs);
    if (!gate.ok) {
      throw new Error("We've got your messages — give us a moment to reply before sending more.");
    }

    const lead = { name: data.name, email: data.email, phone: data.phone, message: data.message };

    const { error } = await anonClient().from("leads").insert(lead);
    if (error) {
      console.error("[whatsapp] lead insert failed:", error.message);
      throw new Error("We couldn't send that just now. Please try again, or message us directly.");
    }

    const budget = takeToken("__global__", GLOBAL.limit, GLOBAL.windowMs);
    const delivered = budget.ok ? await notifyWhatsApp(lead) : false;

    return { ok: true as const, delivered };
  });
