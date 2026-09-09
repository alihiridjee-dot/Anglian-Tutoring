-- Profile photos come off the public URL.
--
-- `20260909120000_profile_photos` put them in a PUBLIC bucket, on the usual
-- reasoning that a profile photo is chosen by its owner to be looked at. That
-- reasoning does not survive who the owners are here: these are photographs of
-- children, and "unguessable URL" is not an access control. A public object is
-- readable by anyone who ever comes into possession of the link — a shared
-- screenshot, a browser history, a proxy log — with no session and no audit.
--
-- So the bucket goes private and the bytes are reached only through a signed
-- URL, which the owner's own client mints under its own JWT. Two consequences
-- follow, and they are the whole shape of this migration:
--
--   • A signed URL EXPIRES, so it must never be stored. The column stops
--     holding a URL and starts holding the object's path.
--   • Reading is no longer open, so it needs a policy of its own. It is scoped
--     to the owner, matching the only place the app renders an avatar.
--
-- Worth being exact about what this does and does not buy, because the
-- difference matters for a decision about children's photos: a signed URL is a
-- time-limited bearer token. For the five minutes it lives, whoever holds it
-- can fetch the image without signing in. It is only ever handed to the owner's
-- own browser, so that window is narrow — but it is not the same guarantee as
-- re-checking the session on every request, which would mean proxying the bytes
-- through the app rather than letting Storage serve them.
--
-- Applied on top of the public version rather than replacing it, because that
-- version is already live on this project; a fresh database replays both and
-- lands in the same place.

-- 1. Close the public route.
update storage.buckets set public = false where id = 'avatars';

-- 2. Reading an object becomes the owner's alone.
--
-- The dropped policy allowed SELECT to everyone, `anon` included — which on a
-- public bucket was merely redundant with the public URL, and on a private one
-- would be the hole itself.
--
-- Owner-only is deliberately the narrowest scope that serves what the app
-- actually renders: your own avatar, in your own header and profile card. It is
-- NOT wide enough for a tutor or a linked parent to see a student's photo in a
-- chat thread or a student list. If an avatar is ever put on one of those
-- surfaces, this policy is the thing to widen — and widening it is a decision
-- about who may look at a child's photograph, so it should be made on purpose
-- rather than discovered as a bug.
drop policy if exists "avatars are readable" on storage.objects;
create policy "avatars owner read"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and name like ((auth.uid())::text || '/%'));

-- 3. The column holds a path now, not a URL.
--
-- Storing a signed URL would be storing something that stops working — the row
-- would go stale five minutes after it was written. The path is stable, and the
-- URL is minted per read.
--
-- Dropped and re-added rather than renamed: the feature has never shipped and
-- the column is empty on this project (verified, 0 rows), so there is nothing
-- to preserve and a rename would leave the old check constraint describing a
-- format the column no longer holds.
alter table public.profiles drop constraint if exists profiles_avatar_url_own_object;
alter table public.profiles drop column if exists avatar_url;

alter table public.profiles add column if not exists avatar_path text;

-- New columns on this table arrive unwritable — see the grant note in
-- `20260806232240_pin_identity_columns_on_profiles_grant_fix`.
grant update (avatar_path) on public.profiles to authenticated;

-- Still user input, so still pinned to the row's own object. The path is now
-- fully determined, which makes the constraint an equality rather than a
-- pattern: there is exactly one photo per account and exactly one place it can
-- live.
alter table public.profiles drop constraint if exists profiles_avatar_path_own_object;
alter table public.profiles add constraint profiles_avatar_path_own_object check (
  avatar_path is null or avatar_path = id::text || '/avatar'
);
