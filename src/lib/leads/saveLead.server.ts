import "@tanstack/react-start/server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface Lead {
  name: string;
  email: string;
  phone: string | null;
  message: string;
}

/**
 * Writes a lead from the contact form or the demo sales chat.
 *
 * With the service role, because these server functions are the only way in:
 * the honeypot and the per-IP limit live here, and a public INSERT grant on
 * `leads` let anyone with the public key write straight to the table and skip
 * both (S-38). That grant is revoked once this is live. The table's CHECK
 * constraints still bound every field, as the old insert policy did.
 */
export async function saveLead(lead: Lead): Promise<{ error: string | null }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Supabase service credential is not configured" };
  const db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { error } = await db.from("leads").insert(lead);
  return { error: error?.message ?? null };
}
