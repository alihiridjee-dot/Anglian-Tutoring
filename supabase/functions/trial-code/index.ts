// Supabase Edge Function: trial-code
//
// The landing page's free-trial pop-up. A visitor gives an email address and
// is sent a code of their own that unlocks a 14-day trial at Checkout (see
// stripe-checkout, which honours it, and 20260927082050_trial_codes.sql).
//
// Public and session-less (verify_jwt off): the people asking have no account
// yet. That makes it a way to send email from our domain to any address, so:
//
//   • a honeypot field (`website`) gets a cheerful answer and nothing sent;
//   • one code per address — asking again re-sends the same code, at most once
//     every RESEND_COOLDOWN, so one inbox cannot be flooded;
//   • at most HOURLY_CAP sends an hour in total, so a script rotating addresses
//     costs a bounded number of emails rather than an unbounded one.
//
// Every accepted request gets the same answer, whether or not an email went,
// so the endpoint never tells anyone whether an address has had a trial.
//
// Required function secrets: RESEND_API_KEY, EMAIL_FROM, APP_URL
// Auto-injected by the platform: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
import { corsHeaders, HttpError } from "../_shared/http.ts";
import { admin } from "../_shared/clients.ts";
import { buildTrialEmail, makeTrialCode } from "../_shared/trialCode.ts";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RESEND_COOLDOWN_MS = 10 * 60_000;
const HOURLY_CAP = 100;

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function newCode(): string {
  return makeTrialCode(crypto.getRandomValues(new Uint8Array(8)));
}

/** The address's code, minting one on first ask. Null once it has been used. */
async function codeFor(
  db: ReturnType<typeof admin>,
  emailHash: string,
): Promise<{ code: string; lastSentAt: string } | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: existing } = await db
      .from("trial_codes")
      .select("code, last_sent_at, redeemed_at")
      .eq("email_hash", emailHash)
      .maybeSingle();
    if (existing) {
      return existing.redeemed_at
        ? null
        : { code: existing.code, lastSentAt: existing.last_sent_at };
    }

    // Not yet "sent": the cooldown starts when an email actually goes, so a
    // failed send can be retried straight away.
    const never = new Date(0).toISOString();
    const { error } = await db
      .from("trial_codes")
      .insert({ code: newCode(), email_hash: emailHash, last_sent_at: never });
    // 23505 is a clash on the code (vanishingly rare) or on the address (a
    // double-click racing itself). Either way, loop: re-read, or re-roll.
    if (error && error.code !== "23505") throw new Error(`trial_codes insert: ${error.message}`);
  }
  throw new Error("Couldn't allocate a trial code.");
}

async function send(to: string, code: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  const appUrl = Deno.env.get("APP_URL");
  if (!key || !from || !appUrl) throw new HttpError(500, "Email isn't configured on the server.");

  const email = buildTrialEmail(code, appUrl.replace(/\/+$/, ""));
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], ...email }),
  });
  if (!res.ok) {
    console.error(`trial-code: send failed: ${res.status} ${await res.text()}`);
    throw new HttpError(502, "We couldn't send the email just now. Please try again.");
  }
}

async function handle(body: { email?: unknown; website?: unknown }) {
  if (typeof body.website === "string" && body.website.trim()) return { ok: true };

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 320 || !EMAIL_RE.test(email)) {
    throw new HttpError(400, "That email address doesn't look right.");
  }

  const db = admin();
  const found = await codeFor(db, await sha256Hex(email));
  if (!found) return { ok: true };
  if (Date.now() - new Date(found.lastSentAt).getTime() < RESEND_COOLDOWN_MS) return { ok: true };

  const { count } = await db
    .from("trial_codes")
    .select("code", { count: "exact", head: true })
    .gt("last_sent_at", new Date(Date.now() - 3_600_000).toISOString());
  if ((count ?? 0) >= HOURLY_CAP) {
    throw new HttpError(
      429,
      "We're sending a lot of codes right now. Please try again in an hour.",
    );
  }

  await send(email, found.code);
  await db
    .from("trial_codes")
    .update({ last_sent_at: new Date().toISOString() })
    .eq("code", found.code);
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown; website?: unknown };
    const result = await handle(body);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Something went wrong. Please try again.";
    if (!(err instanceof HttpError)) console.error("trial-code:", err);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
