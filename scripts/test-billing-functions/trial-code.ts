/** S-1, from the trial-code function's side: Gmail variants and plus-tags are
 * one person, a burst of requests sends one email, one IP can't spend the
 * hourly cap, nothing is created while capped, and a capped answer doesn't say
 * whether an address has had a trial. Runs the real function against the
 * in-memory Supabase in this folder, with Resend stubbed. No network.
 *
 *   DENO_NO_PACKAGE_JSON=1 deno run --no-config --cached-only \
 *     --import-map=scripts/test-billing-functions/import_map.json \
 *     --allow-env --allow-read scripts/test-billing-functions/trial-code.ts
 */
import assert from "node:assert/strict";
import { loadHandler, post } from "./harness.ts";
import { DB, resetDb, table } from "./mock-supabase.ts";

Deno.env.set("RESEND_API_KEY", "re_dummy");
Deno.env.set("EMAIL_FROM", "Anglia Educate <hello@app.test>");

// Resend: records every email, or fails when told to.
const sent: { to: string; text: string }[] = [];
let resendDown = false;
globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith("https://api.resend.com/")) {
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  }
  if (resendDown) return Promise.resolve(new Response("down", { status: 500 }));
  const body = JSON.parse(String(init?.body));
  sent.push({ to: body.to[0], text: body.text });
  return Promise.resolve(Response.json({ id: "email_1" }));
};

const trialCode = await loadHandler("../../supabase/functions/trial-code/index.ts");

const sha = async (s: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");

function world() {
  resetDb();
  sent.length = 0;
  resendDown = false;
  // The per-IP claim, as the migration defines it.
  const seen = new Map<string, number>();
  DB.rpcs.claim_trial_code_request = ({ _ip_hash, _limit }) => {
    const used = seen.get(_ip_hash) ?? 0;
    if (used >= _limit) return { data: false, error: null };
    seen.set(_ip_hash, used + 1);
    return { data: true, error: null };
  };
}
let ipCounter = 0;
const ask = async (email: string, ip = `203.0.113.${++ipCounter}`) => {
  const res = await trialCode(post({ email }, { "cf-connecting-ip": ip }));
  return { status: res.status, body: await res.json() };
};
const codes = () => table("trial_codes");
const longAgo = () => new Date(Date.now() - 11 * 60_000).toISOString();

// 1. One person, however they write their Gmail address.
world();
assert.equal((await ask("Name+promo@Gmail.com")).status, 200);
assert.equal(sent.length, 1);
assert.equal(sent[0].to, "name+promo@gmail.com", "The email didn't go to the address as typed");
await ask("n.a.m.e@googlemail.com");
await ask("name@gmail.com");
assert.equal(codes().length, 1, "A Gmail variant got a code of its own");
assert.equal(sent.length, 1, "A variant inside the cooldown was sent another email");
codes()[0].last_sent_at = longAgo();
await ask("n.a.m.e@googlemail.com");
assert.equal(sent.length, 2);
assert.ok(sent[1].text.includes(codes()[0].code), "The resend wasn't the same code");

// …and a plus-tag on any provider is the same mailbox.
await ask("sam+1@outlook.com");
await ask("sam+2@outlook.com");
assert.equal(codes().length, 2, "A plus-tag made a new person");

// A variant of an address that has redeemed gets nothing, quietly.
world();
codes().push({
  code: "AE-AAAA-BBBB",
  email_hash: await sha("name@gmail.com"),
  last_sent_at: longAgo(),
  redeemed_at: new Date().toISOString(),
});
const redeemed = await ask("na.me+again@gmail.com");
assert.deepEqual(redeemed, { status: 200, body: { ok: true } });
assert.equal(sent.length, 0);
assert.equal(codes().length, 1, "A redeemed person was minted a fresh code");

// 2. A burst for one address sends one email, not one each.
world();
await Promise.all(Array.from({ length: 6 }, () => ask("burst@example.com")));
assert.equal(sent.length, 1, "A burst of requests sent more than one email");

// 3. One IP gets five requests an hour, and the sixth creates nothing.
world();
for (let i = 0; i < 5; i++)
  assert.equal((await ask(`kid${i}@example.com`, "198.51.100.7")).status, 200);
const sixth = await ask("kid5@example.com", "198.51.100.7");
assert.equal(sixth.status, 429);
assert.equal(codes().length, 5, "A request over the IP limit still created a code");

// 4. At the hourly cap: no new rows, and the same answer whether or not the
//    address has had a trial.
world();
for (let i = 0; i < 100; i++) {
  codes().push({ code: `AE-CAP${i}`, email_hash: `h${i}`, last_sent_at: new Date().toISOString() });
}
codes().push({
  code: "AE-USED-0000",
  email_hash: await sha("used@example.com"),
  last_sent_at: longAgo(),
  redeemed_at: new Date().toISOString(),
});
const fresh = await ask("new@example.com");
const used = await ask("used@example.com");
assert.equal(fresh.status, 429);
assert.deepEqual(used, fresh, "A capped answer gave away that an address had redeemed");
assert.equal(codes().length, 101, "A row was created while capped");

// 5. A failed send gives the cooldown back, so a retry goes straight away.
world();
resendDown = true;
assert.equal((await ask("retry@example.com")).status, 502);
resendDown = false;
await ask("retry@example.com");
assert.equal(sent.length, 1, "A failed send blocked the retry for the cooldown");

// 6. Codes sent before canonicalising are still found under the typed address.
world();
codes().push({
  code: "AE-OLDS-CODE",
  email_hash: await sha("first.last@gmail.com"),
  last_sent_at: longAgo(),
  redeemed_at: null,
});
await ask("first.last@gmail.com");
assert.equal(codes().length, 1, "An address with an old code was given a second one");
assert.ok(sent[0].text.includes("AE-OLDS-CODE"));

console.log("trial-code: all checks passed");
