/**
 * One-off: hand the service-role key to Supabase Vault so the pg_cron job
 * `cleanup-homework-files-daily` can authenticate against the
 * `cleanup-homework-files` edge function.
 *
 * Reads the key straight from your environment and sends it over HTTPS, so the
 * secret never has to be pasted into a SQL statement, a migration, or a chat
 * window.
 *
 * Usage — set SUPABASE_SERVICE_ROLE_KEY in .env first (Supabase dashboard →
 * Project Settings → API → service_role), then:
 *
 *   bun --env-file=.env scripts/store-cron-secret.ts
 *
 * Requires the `public.__store_cron_secret(text)` helper, which was dropped
 * after the initial setup. Recreate it (as the service role / SQL editor):
 *
 *   create or replace function public.__store_cron_secret(_value text)
 *   returns text language plpgsql security definer set search_path = public, vault as $$
 *   declare existing uuid;
 *   begin
 *     select id into existing from vault.secrets where name = 'cron_service_role_key';
 *     if existing is not null then
 *       perform vault.update_secret(existing, _value); return 'updated';
 *     end if;
 *     perform vault.create_secret(_value, 'cron_service_role_key', 'pg_cron -> edge function auth');
 *     return 'created';
 *   end $$;
 *   revoke all on function public.__store_cron_secret(text) from public, anon, authenticated;
 *
 * ...and drop it again afterwards:
 *
 *   drop function public.__store_cron_secret(text);
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Copy the service_role key from the Supabase dashboard into .env first.",
  );
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await supabase.rpc(
  // Not in the generated types — this helper is intentionally temporary.
  "__store_cron_secret" as never,
  { _value: key } as never,
);

if (error) {
  console.error("Failed to store the Vault secret:", error.message);
  process.exit(1);
}

console.log(`Vault secret 'cron_service_role_key': ${data}`);
console.log("The daily cleanup job can now authenticate.");
