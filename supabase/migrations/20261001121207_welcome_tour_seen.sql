-- When the signed-in user finished, or skipped, the welcome tour.
--
-- The first-run tour used to be armed by a flag in the browser's localStorage,
-- written on the device where setup finished. A student who set up on a phone
-- and first studied on a laptop never saw it, and a parent never saw it at all:
-- their account has no setup step to write the flag. Keeping the answer on the
-- profile makes it follow the account to every device.
--
-- Null means "not seen yet", and the dashboard starts the tour on the next
-- visit. Existing rows are left null on purpose, so everyone already signed up
-- sees the new tour once.

alter table public.profiles add column if not exists welcome_tour_seen_at timestamptz;

-- `20260806232240_pin_identity_columns_on_profiles_grant_fix` dropped the
-- table-level UPDATE grant, so a new column arrives unwritable until it is
-- granted by name. "profiles self update" already holds the write to the
-- caller's own row, and nothing reads this column to decide access.
grant update (welcome_tour_seen_at) on public.profiles to authenticated;
