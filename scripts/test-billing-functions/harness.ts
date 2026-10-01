// Loads a real edge function's Deno.serve handler in-process, so a test can call
// it with a Request. The import map in this folder swaps supabase-js and the
// Stripe SDK for the in-memory stand-ins next to this file: no network.
export type Handler = (req: Request) => Promise<Response>;

for (const [k, v] of Object.entries({
  SUPABASE_URL: "http://127.0.0.1:9",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-dummy",
  STRIPE_SECRET_KEY: "sk_test_dummy",
  STRIPE_WEBHOOK_SECRET: "whsec_dummy",
  APP_URL: "https://app.test",
}))
  Deno.env.set(k, v);

export async function loadHandler(path: string): Promise<Handler> {
  let captured: Handler | null = null;
  const real = Deno.serve;
  (Deno as unknown as { serve: (h: Handler) => unknown }).serve = (h: Handler) => {
    captured = h;
    return {};
  };
  await import(path);
  (Deno as unknown as { serve: typeof real }).serve = real;
  if (!captured) throw new Error(`no handler captured from ${path}`);
  return captured;
}

export function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://fn.test/", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
