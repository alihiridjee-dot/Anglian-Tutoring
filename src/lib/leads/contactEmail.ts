/**
 * Emails the team each contact-form enquiry, so a parent's message is read the
 * day it arrives instead of sitting in the `leads` table, which no page shows.
 *
 * It works like `notifyWhatsApp` in whatsappLead.functions.ts: the lead is
 * saved first and this only tells the team about it, so it never throws. A
 * failed send is logged (the status, never the visitor's details) and the
 * visitor still hears that their message arrived, because it did.
 *
 * Sent through Resend, like the edge functions' emails. It needs two server
 * env vars on Vercel: RESEND_API_KEY, and EMAIL_FROM (an address on the domain
 * verified in Resend). Without them nothing is sent and the log says why.
 */

/** Where enquiries go: the address the contact section shows visitors. */
export const CONTACT_INBOX = "angliaeducate@gmail.com";

export interface ContactLead {
  name: string;
  email: string;
  phone: string | null;
  message: string;
}

/** One line, capped, so a name can't break or bloat the subject. */
function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildContactEmail(lead: ContactLead, from: string) {
  return {
    // A bare address shows as "noreply" in the inbox; name the sender.
    from: from.includes("<") ? from : `Anglia Educate website <${from}>`,
    to: [CONTACT_INBOX],
    // Pressing Reply answers the parent, not the no-reply sender.
    reply_to: lead.email,
    subject: `New enquiry from ${oneLine(lead.name, 80)}`,
    text: [
      "Someone sent a message through the contact form on the website.",
      "",
      `Name: ${lead.name}`,
      `Email: ${lead.email}`,
      `Phone: ${lead.phone ?? "not given"}`,
      "",
      lead.message,
      "",
      "Reply to this email to answer them.",
    ].join("\n"),
  };
}

/** Sends the enquiry to CONTACT_INBOX. True when Resend accepted it. */
export async function emailContactLead(lead: ContactLead): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    console.error("[contact] RESEND_API_KEY or EMAIL_FROM not set; enquiry saved, not emailed");
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildContactEmail(lead, from)),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.error(`[contact] email failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[contact] email threw:", err instanceof Error ? err.message : "unknown");
    return false;
  }
}
