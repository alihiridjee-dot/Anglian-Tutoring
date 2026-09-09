-- Profile photos.
--
-- A user may attach one photo to their account, uploaded from /profile. It
-- replaces the initials disc in the header for them and for anyone who is
-- already allowed to see their profile row.
--
-- The bytes live in a PUBLIC `avatars` bucket rather than behind signed URLs
-- like `resources`. A profile photo is chosen by its owner to be looked at, so
-- the cost of signing — a round trip everywhere an avatar renders, plus refresh
-- logic when the URL expires — buys nothing here. Write access is still the
-- owner's alone; it is only reading that is open.

-- 1. Where the photo is remembered.
alter table public.profiles add column if not exists avatar_url text;

-- 2. Make it writable by its owner.
--
-- `20260806232240_pin_identity_columns_on_profiles_grant_fix` dropped the
-- table-level UPDATE grant and re-issued named columns, so every column added
-- to `profiles` since then arrives unwritable and stays that way until someone
-- grants it deliberately. That is the intended direction to fail in — but it
-- means omitting this line ships a save button that fails with a permission
-- error no RLS policy can explain.
grant update (avatar_url) on public.profiles to authenticated;

-- 3. Pin the column to the row's own object.
--
-- `authenticated` can PATCH this column directly through PostgREST, so the
-- value is user input, not something the app gets to assume it wrote. Without a
-- constraint a user could point their avatar at any URL on the internet — an
-- off-site tracker that fires on every viewer of their profile — or at another
-- user's object. The check pins it to the public `avatars` prefix, under a
-- folder named for this row's own id, with an optional `?v=` cache-buster.
--
-- The host pattern is left generic rather than naming the project ref, so a
-- restore into another project doesn't reject every existing row.
alter table public.profiles drop constraint if exists profiles_avatar_url_own_object;
alter table public.profiles add constraint profiles_avatar_url_own_object check (
  avatar_url is null
  or (
    length(avatar_url) <= 512
    and avatar_url ~ (
      '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/avatars/'
      || id::text
      || '/[A-Za-z0-9._-]+(\?v=[0-9]+)?$'
    )
  )
);

-- 4. The bucket.
--
-- `allowed_mime_types` is image/jpeg and nothing else, which is not a
-- formatting preference: this bucket is served publicly from the project's own
-- origin, and an uploaded SVG is a script that runs there. The client re-encodes
-- every chosen file to JPEG before upload, so the narrow list costs nothing and
-- closes that off at the door. The size limit is the second half of the same
-- argument — the client downscales to a 512px square, so a megabyte is already
-- far more headroom than a correct upload needs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 5. Who may write.
--
-- Reads are open because the bucket is public; the public URL never consults
-- these policies anyway, and the SELECT policy is what lets the owner's own
-- client see the object it just wrote. Every write is scoped by path prefix to
-- a folder named for the caller, the same shape the `resources` submission
-- policies use.
drop policy if exists "avatars are readable" on storage.objects;
create policy "avatars are readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars owner upload" on storage.objects;
create policy "avatars owner upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and name like ((auth.uid())::text || '/%'));

-- Replacing a photo is an upsert onto the same path, which Storage performs as
-- an UPDATE. Without this the second upload fails where the first succeeded.
drop policy if exists "avatars owner replace" on storage.objects;
create policy "avatars owner replace"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and name like ((auth.uid())::text || '/%'))
  with check (bucket_id = 'avatars' and name like ((auth.uid())::text || '/%'));

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and name like ((auth.uid())::text || '/%'));
