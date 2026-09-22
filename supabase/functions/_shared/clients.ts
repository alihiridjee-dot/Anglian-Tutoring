// Service-role Supabase and Stripe clients for the functions that talk to
// both. Fresh per call: nothing is cached across requests. Lifted from two
// byte-identical copies.
//
// STRIPE_SECRET_KEY exists only here and in stripe-webhook — never in the
// browser bundle.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { HttpError } from "./http.ts";

export function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export function stripeClient() {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new HttpError(500, "Stripe is not configured on the server.");
  return new Stripe(key, { apiVersion: "2024-12-18.acacia" });
}
