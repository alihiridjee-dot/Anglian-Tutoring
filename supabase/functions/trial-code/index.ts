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
//   • one code per person — the address is reduced to canonicalEmail first, so
//     plus-tags and Gmail's dots don't make new people — and asking again
//     re-sends the same code, at most once every RESEND_COOLDOWN, claimed
//     atomically so a burst of requests sends one email, not one each;
//   • at most IP_LIMIT requests an hour from one address (Cloudflare's
//     cf-connecting-ip), so one script can't spend the hourly cap for everyone;
//   • at most HOURLY_CAP sends an hour in total, so a script rotating addresses
//     costs a bounded number of emails rather than an unbounded one. Checked
//     before any row is created.
//
// Every accepted request gets the same answer, whether or not an email went,
// and the limits answer before the address is looked up, so the endpoint never
// tells anyone whether an address has had a trial.
//
// Required function secrets: RESEND_API_KEY, EMAIL_FROM, APP_URL
// Auto-injected by the platform: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
import { corsHeaders, HttpError } from "../_shared/http.ts";
import { admin } from "../_shared/clients.ts";
import { buildTrialEmail, canonicalEmail, makeTrialCode } from "../_shared/trialCode.ts";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RESEND_COOLDOWN_MS = 10 * 60_000;
const HOURLY_CAP = 100;
const IP_LIMIT = 5;
const BUSY = "We're sending a lot of codes right now. Please try again in an hour.";

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function newCode(): string {
  return makeTrialCode(crypto.getRandomValues(new Uint8Array(8)));
}

/**
 * The person's code, minting one on first ask. Null once one has been used.
 * Looked up under the canonical address and, for codes sent before addresses
 * were canonicalised, the address as typed.
 */
async function codeFor(
  db: ReturnType<typeof admin>,
  emailHash: string,
  typedHash: string,
): Promise<{ code: string; lastSentAt: string } | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: rows, error: readError } = await db
      .from("trial_codes")
      .select("code, last_sent_at, redeemed_at")
      .in("email_hash", [...new Set([emailHash, typedHash])]);
    if (readError) throw new Error(`trial_codes read: ${readError.message}`);
    if (rows?.length) {
      if (rows.some((r) => r.redeemed_at)) return null;
      return { code: rows[0].code, lastSentAt: rows[0].last_sent_at };
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

/** The caller's address as Cloudflare saw it (a client can't set this header). */
function clientIp(req: Request): string | null {
  return (
    req.headers.get("cf-connecting-ip")?.trim() || req.headers.get("x-real-ip")?.trim() || null
  );
}

async function handle(req: Request, body: { email?: unknown; website?: unknown }) {
  if (typeof body.website === "string" && body.website.trim()) return { ok: true };

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 320 || !EMAIL_RE.test(email)) {
    throw new HttpError(400, "That email address doesn't look right.");
  }

  const db = admin();

  // The limits come first, before the address is looked up or a row is made:
  // so no rows pile up while capped, and a capped answer is the same whether
  // or not this address has had a trial.
  const ip = clientIp(req);
  if (ip) {
    const { data: allowed, error } = await db.rpc("claim_trial_code_request", {
      _ip_hash: await sha256Hex(ip),
      _limit: IP_LIMIT,
    });
    if (error) throw new Error(`claim_trial_code_request: ${error.message}`);
    if (!allowed) throw new HttpError(429, BUSY);
  } else {
    console.warn("trial-code: no client IP header; per-IP limit skipped");
  }

  const { count, error: countError } = await db
    .from("trial_codes")
    .select("code", { count: "exact", head: true })
    .gt("last_sent_at", new Date(Date.now() - 3_600_000).toISOString());
  if (countError) throw new Error(`trial_codes count: ${countError.message}`);
  if ((count ?? 0) >= HOURLY_CAP) throw new HttpError(429, BUSY);

  const found = await codeFor(db, await sha256Hex(canonicalEmail(email)), await sha256Hex(email));
  if (!found) return { ok: true };

  // Claim this send before making it: only the request that moves last_sent_at
  // past the cooldown sends. Checking and then setting let a burst of requests
  // for one address all send.
  const sentAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await db
    .from("trial_codes")
    .update({ last_sent_at: sentAt })
    .eq("code", found.code)
    .lt("last_sent_at", new Date(Date.now() - RESEND_COOLDOWN_MS).toISOString())
    .select("code");
  if (claimError) throw new Error(`trial_codes claim: ${claimError.message}`);
  if (!claimed?.length) return { ok: true };

  try {
    await send(email, found.code);
  } catch (err) {
    // Give the cooldown back, so a failed send can be retried at once.
    await db
      .from("trial_codes")
      .update({ last_sent_at: found.lastSentAt })
      .eq("code", found.code)
      .eq("last_sent_at", sentAt);
    throw err;
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown; website?: unknown };
    const result = await handle(req, body);
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
