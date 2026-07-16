-- Parent linking, rotatable invite codes, and the link lifecycle.
--
-- Pending invites live in their own table rather than as a status column on
-- parent_student_links, and that is the load-bearing decision here.
--
-- Four policies already treat a row in parent_student_links as proof of an
-- ACTIVE relationship and hand the parent the child's data:
--   • public.profiles              "profiles parent reads linked"
--   • public.homework_submissions  "hs read scoped"
--   • public.resources             "resources read scoped"
--   • storage.objects              "resources bucket read scoped"
-- None of them filter on a status. A pending row in that table would therefore
-- expose a child's profile, grades, homework and files to someone who has not
-- accepted yet — unless all four were rewritten in lockstep, where a single
-- miss is a silent data leak rather than a visible error.
--
-- Keeping pending invites in parent_link_invites means membership of
-- parent_student_links keeps meaning exactly what those four policies already
-- assume, and this migration adds no new way to read a child's data.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Invite codes: strong, and rotatable
-- ---------------------------------------------------------------------------

-- The old codes were 'ANG-' || 6 hex chars of md5(id || clock_timestamp) — 24
-- bits (~16.7M), and permanent, so a code shared into a group chat or a lost
-- phone could never be taken back. This generator is a CSPRNG draw and pairs
-- with rotate_student_invite_code below.
create or replace function public.gen_student_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Crockford base32 — no I, L, O or U, so a code can't be misread down the
  -- phone (1/I, 0/O) or land on an unfortunate word.
  k_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea;
  v_code text;
  i int;
begin
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := 'ANG-';
    for i in 1..8 loop
      -- 256 is a whole multiple of 32, so this modulo is unbiased.
      -- 8 chars x 5 bits = 40 bits (~1.1 trillion).
      v_code := v_code || substr(k_alphabet, 1 + (get_byte(v_bytes, i - 1) % 32), 1);
    end loop;
    -- SECURITY DEFINER is required, not incidental: under the caller's own RLS
    -- ("profiles self read") this uniqueness check can only see the caller's
    -- row, so it would wave through a code already held by someone else and
    -- leave the UNIQUE index to fail the write.
    exit when not exists (
      select 1 from public.profiles p where p.student_invite_code = v_code
    );
  end loop;
  return v_code;
end;
$$;

-- Internal only — reachable through the definer functions below, never called
-- directly by a client.
revoke all on function public.gen_student_invite_code() from public, anon, authenticated;

-- Point the existing signup trigger at the strong generator. The trigger itself
-- is left alone, so handle_new_user and the parent_invite_code signup path
-- carry on unchanged; only the code's shape improves.
--
-- SECURITY DEFINER is new here: profiles can be inserted directly by a user
-- ("profiles self insert"), and an invoker-rights trigger would then hit the
-- REVOKE above and fail the insert.
create or replace function public.generate_invite_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.student_invite_code is null then
    new.student_invite_code := public.gen_student_invite_code();
  end if;
  return new;
end;
$$;

-- Lets a student invalidate a code that leaked.
--
-- Deliberately does NOT touch parent_student_links: rotation stops the code
-- being used for a NEW signup link, while parents already linked stay linked.
-- Removing an existing parent's access is unlink_parent's job, and conflating
-- the two would make "my code leaked" silently cut off a real parent.
create or replace function public.rotate_student_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_code := public.gen_student_invite_code();

  update public.profiles set student_invite_code = v_code where id = auth.uid();
  if not found then
    raise exception 'No profile found for the current user' using errcode = '42501';
  end if;

  return v_code;
end;
$$;

revoke all on function public.rotate_student_invite_code() from public, anon;
grant execute on function public.rotate_student_invite_code() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Pending invites
-- ---------------------------------------------------------------------------

create table if not exists public.parent_link_invites (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  -- Addressed to an email, not a user id: the invitee may not have an account
  -- yet, and the acceptance check is "this session owns that mailbox".
  parent_email text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  responded_at timestamptz,
  responded_by uuid references auth.users(id) on delete set null,
  constraint parent_link_invites_status_check
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  -- Stored normalised so the RLS email match below is a plain equality.
  constraint parent_link_invites_email_normalised
    check (parent_email = lower(btrim(parent_email)) and length(parent_email) between 3 and 320)
);

-- One live invite per (student, email); answered ones stay as history.
create unique index if not exists uq_parent_link_invites_pending
  on public.parent_link_invites (student_id, parent_email)
  where status = 'pending';
create index if not exists idx_parent_link_invites_email_pending
  on public.parent_link_invites (parent_email)
  where status = 'pending';
create index if not exists idx_parent_link_invites_student
  on public.parent_link_invites (student_id);

alter table public.parent_link_invites enable row level security;

-- SELECT only. Every write goes through the SECURITY DEFINER RPCs below, which
-- is what stops a student writing themselves an 'accepted' invite, or an
-- invitee inventing one addressed to their own mailbox.
grant select on public.parent_link_invites to authenticated;
grant all on public.parent_link_invites to service_role;

create policy "pli student reads own"
  on public.parent_link_invites for select to authenticated
  using (student_id = auth.uid());

-- coalesce to '' rather than null: the email check constraint enforces
-- length >= 3, so a session with no email matches nothing instead of erroring.
create policy "pli invitee reads addressed"
  on public.parent_link_invites for select to authenticated
  using (parent_email = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "pli staff reads"
  on public.parent_link_invites for select to authenticated
  using (
    private.has_role(auth.uid(), 'tutor'::public.app_role)
    or private.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- ---------------------------------------------------------------------------
-- 3. Link lifecycle RPCs
-- ---------------------------------------------------------------------------

-- Student invites a parent who already holds an account.
--
-- Returns a status rather than raising for the "can't invite them" cases, so
-- the UI can explain itself. That does make this an account-existence oracle
-- for a signed-in user — accepted deliberately: the alternative is telling a
-- student "sent!" when nothing was sent, and the invite still binds nothing
-- until the parent accepts.
create or replace function public.invite_parent_by_email(_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_student uuid := auth.uid();
  v_email text := lower(btrim(coalesce(_email, '')));
  v_parent uuid;
  v_parent_role public.profile_role;
  v_invite_id uuid;
  v_student_name text;
begin
  if v_student is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if length(v_email) > 320 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like a valid email address' using errcode = '22023';
  end if;

  if v_email = lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'You cannot invite yourself' using errcode = '22023';
  end if;

  select u.id into v_parent from auth.users u where lower(u.email) = v_email;

  if v_parent is null then
    -- Nothing to attach an invite to. The caller's invite code already covers
    -- this: handle_new_user links a parent who signs up carrying it.
    return jsonb_build_object('status', 'no_account');
  end if;

  select p.role into v_parent_role from public.profiles p where p.id = v_parent;
  if v_parent_role is distinct from 'parent'::public.profile_role then
    return jsonb_build_object('status', 'not_a_parent');
  end if;

  if exists (
    select 1 from public.parent_student_links l
    where l.parent_id = v_parent and l.student_id = v_student
  ) then
    return jsonb_build_object('status', 'already_linked');
  end if;

  -- Re-inviting refreshes the existing pending row's clock rather than
  -- stacking duplicates.
  insert into public.parent_link_invites (student_id, parent_email)
  values (v_student, v_email)
  on conflict (student_id, parent_email) where status = 'pending'
  do update set expires_at = now() + interval '14 days', created_at = now()
  returning id into v_invite_id;

  select coalesce(nullif(btrim(p.display_name), ''), 'A student')
    into v_student_name
  from public.profiles p where p.id = v_student;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_parent, 'parent_invite', 'Parent access request',
    v_student_name || ' has invited you to follow their progress.', '/parents'
  );

  return jsonb_build_object('status', 'invited', 'invite_id', v_invite_id);
end;
$$;

revoke all on function public.invite_parent_by_email(text) from public, anon;
grant execute on function public.invite_parent_by_email(text) to authenticated;

-- Parent accepts or declines. Accepting is the ONLY path that writes
-- parent_student_links for a non-tutor, and it is the point where the four
-- access policies start applying.
create or replace function public.respond_to_parent_invite(_invite_id uuid, _accept boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_inv public.parent_link_invites;
  v_role public.profile_role;
  v_parent_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_inv from public.parent_link_invites where id = _invite_id for update;
  if not found then
    raise exception 'Invitation not found' using errcode = '42501';
  end if;

  -- The claim is "this session owns the mailbox it was addressed to", not
  -- "this session knows the id" — an id alone must never accept.
  if v_inv.parent_email is distinct from v_email or v_email = '' then
    raise exception 'This invitation is not addressed to your account' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'This invitation has already been answered' using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'This invitation has expired' using errcode = '22023';
  end if;

  if not _accept then
    update public.parent_link_invites
       set status = 'declined', responded_at = now(), responded_by = v_uid
     where id = _invite_id;
    return jsonb_build_object('status', 'declined');
  end if;

  -- Gate on the role in the data, never on who the caller is.
  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role is distinct from 'parent'::public.profile_role then
    raise exception 'Only a parent account can accept a parent invitation' using errcode = '42501';
  end if;

  insert into public.parent_student_links (parent_id, student_id)
  values (v_uid, v_inv.student_id)
  on conflict (parent_id, student_id) do nothing;

  update public.parent_link_invites
     set status = 'accepted', responded_at = now(), responded_by = v_uid
   where id = _invite_id;

  select coalesce(nullif(btrim(p.display_name), ''), 'Your parent/guardian')
    into v_parent_name
  from public.profiles p where p.id = v_uid;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_inv.student_id, 'parent_invite', 'Parent access accepted',
    v_parent_name || ' can now follow your progress.', '/parents'
  );

  return jsonb_build_object('status', 'accepted');
end;
$$;

revoke all on function public.respond_to_parent_invite(uuid, boolean) from public, anon;
grant execute on function public.respond_to_parent_invite(uuid, boolean) to authenticated;

-- Student withdraws an invite they haven't had answered yet.
create or replace function public.revoke_parent_invite(_invite_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  update public.parent_link_invites
     set status = 'revoked', responded_at = now(), responded_by = auth.uid()
   where id = _invite_id
     and student_id = auth.uid()
     and status = 'pending';

  if not found then
    raise exception 'No pending invitation to withdraw' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.revoke_parent_invite(uuid) from public, anon;
grant execute on function public.revoke_parent_invite(uuid) to authenticated;

-- Either side of a link can end it.
--
-- Needed because "psl tutor writes" is the only permissive policy for DELETE on
-- parent_student_links, so despite the table's DELETE grant a student or parent
-- cannot remove their own link without going through here.
create or replace function public.unlink_parent(_link_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  delete from public.parent_student_links l
   where l.id = _link_id
     and (l.student_id = auth.uid() or l.parent_id = auth.uid());

  if not found then
    raise exception 'Link not found' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.unlink_parent(uuid) from public, anon;
grant execute on function public.unlink_parent(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Read helpers
-- ---------------------------------------------------------------------------

-- A student cannot read their parent's profile: "profiles parent reads linked"
-- only grants the parent -> student direction, and emails live in auth.users,
-- which authenticated cannot read at all. Without this the student's own
-- "Linked Parents" list could only render opaque uuids.
create or replace function public.list_my_parent_links()
returns table (
  link_id uuid,
  parent_id uuid,
  display_name text,
  email text,
  linked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.parent_id, p.display_name, u.email::text, l.created_at
  from public.parent_student_links l
  join auth.users u on u.id = l.parent_id
  left join public.profiles p on p.id = l.parent_id
  where l.student_id = auth.uid()
  order by l.created_at;
$$;

revoke all on function public.list_my_parent_links() from public, anon;
grant execute on function public.list_my_parent_links() to authenticated;

-- The parent-side mirror.
create or replace function public.list_my_child_links()
returns table (
  link_id uuid,
  student_id uuid,
  display_name text,
  email text,
  linked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.student_id, p.display_name, u.email::text, l.created_at
  from public.parent_student_links l
  join auth.users u on u.id = l.student_id
  left join public.profiles p on p.id = l.student_id
  where l.parent_id = auth.uid()
  order by l.created_at;
$$;

revoke all on function public.list_my_child_links() from public, anon;
grant execute on function public.list_my_child_links() to authenticated;
