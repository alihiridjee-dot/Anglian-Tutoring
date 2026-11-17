-- "My parent is paying": a one-time link a student hands their parent.
--
-- Ali (17 Nov 2026): on the plan page, a student whose parent holds the card
-- presses one button and gets a QR code and a link. The parent opens it on
-- their own phone, makes a parent account (or logs in), is linked to the child
-- and lands on Stripe with the child's plan. The student's screen unlocks by
-- itself when the payment lands.
--
-- Ali chose a one-time link over the student's invite code: the link works for
-- one parent, for 24 hours, and then it is dead. A forwarded or leaked link
-- can't be used to link to the child later. Making a new one kills the old.
--
-- The link carries a random token (122 bits, from gen_random_uuid). Only its
-- SHA-256 is stored, so a read of the table can't be turned back into links.
--
-- Who sees what:
--   - Anyone holding a live token, signed in or not, sees the child's first
--     name, level and subjects, and the cadence they picked. That is what the
--     parent pays for, shown before they make an account. Nothing else, and
--     never the child's id.
--   - The parent who used it gets the child's id back, for Checkout.
--   - The student sees whether their own link was used, and by whom.
--   - Nobody reads the table directly.
--
--   create_parent_join_link(cadence)  student: a new link, the old one killed.
--   peek_parent_join_link(token)      anyone: the plan, or why it's dead.
--   redeem_parent_join_link(token)    parent: link to the child, once.
--   parent_join_link_status(token)    student: waiting, joined or expired.

create table public.parent_join_links (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,
  cadence text not null check (cadence in ('weekly', 'monthly', 'termly')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null
);

create index parent_join_links_student on public.parent_join_links (student_id, created_at desc);

alter table public.parent_join_links enable row level security;
-- No policies: every read and write goes through the functions below.
revoke all on table public.parent_join_links from public, anon, authenticated;

-- A tutor is never a student (20261003115242), so a tutor can't hand out a
-- link to link a parent to them.
create trigger student_row_not_staff
  before insert or update of student_id on public.parent_join_links
  for each row execute function private.refuse_student_row_for_staff('student_id');

-- What the parent is shown and pays for: first name, level, each subject and
-- its exam board, and the cadence.
create or replace function private.parent_join_plan(_student uuid, _cadence text)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select jsonb_build_object(
    'student_name',
    coalesce(nullif(split_part(btrim(coalesce(p.display_name, '')), ' ', 1), ''), 'your child'),
    'level', p.level,
    'subjects', coalesce(
      (select jsonb_agg(
                jsonb_build_object('subject', e.subject::text, 'board', e.board::text)
                order by e.subject::text)
         from public.student_enrolments e where e.student_id = _student),
      '[]'::jsonb),
    'cadence', _cadence)
  from public.profiles p
  where p.id = _student;
$$;
revoke all on function private.parent_join_plan(uuid, text) from public, anon, authenticated;

create or replace function private.parent_join_token_hash(_token text)
 returns text
 language sql
 immutable
 set search_path to ''
as $$
  select encode(sha256(convert_to(btrim(coalesce(_token, '')), 'UTF8')), 'hex');
$$;
revoke all on function private.parent_join_token_hash(text) from public, anon, authenticated;

-- A student makes a link. Any older link of theirs that nobody used dies now,
-- so there is only ever one that works. Twenty an hour, to stop a loop.
create or replace function public.create_parent_join_link(_cadence text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  v_student uuid := auth.uid();
  v_role public.profile_role;
  v_token text;
  v_expires timestamptz := now() + interval '24 hours';
begin
  if v_student is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select p.role into v_role from public.profiles p where p.id = v_student;
  if v_role is distinct from 'student'::public.profile_role or private.is_staff(v_student) then
    raise exception 'Only a student can make a link for a parent.' using errcode = '42501';
  end if;

  if _cadence is null or _cadence not in ('weekly', 'monthly', 'termly') then
    raise exception 'Pick weekly, monthly or termly.' using errcode = '22023';
  end if;

  if (select count(*) from public.parent_join_links l
       where l.student_id = v_student and l.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many links in the last hour. Try again later.' using errcode = '54000';
  end if;

  update public.parent_join_links
     set expires_at = now()
   where student_id = v_student and used_at is null and expires_at > now();

  v_token := replace(gen_random_uuid()::text, '-', '');
  insert into public.parent_join_links (student_id, token_hash, cadence, expires_at)
  values (v_student, private.parent_join_token_hash(v_token), _cadence, v_expires);

  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end;
$$;
revoke all on function public.create_parent_join_link(text) from public, anon;
grant execute on function public.create_parent_join_link(text) to authenticated;

-- The page the parent opens asks this first, signed in or not.
--   ok       the link works; the plan is in the answer. `joined` is true when
--            the caller already used it and is still linked (a reload after
--            linking, or back from Stripe).
--   used     someone else used it, or the caller did and was unlinked since.
--   expired  24 hours passed, or the student made a newer link.
--   not_found no such link.
create or replace function public.peek_parent_join_link(_token text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $$
declare
  v_caller uuid := auth.uid();
  v_row public.parent_join_links%rowtype;
begin
  select * into v_row from public.parent_join_links l
   where l.token_hash = private.parent_join_token_hash(_token);
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_row.used_at is not null then
    if v_caller is not null and v_row.used_by = v_caller and exists (
      select 1 from public.parent_student_links k
       where k.parent_id = v_caller and k.student_id = v_row.student_id
    ) then
      return jsonb_build_object('status', 'ok', 'joined', true)
        || private.parent_join_plan(v_row.student_id, v_row.cadence);
    end if;
    return jsonb_build_object('status', 'used');
  end if;

  if v_row.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;

  return jsonb_build_object('status', 'ok', 'joined', false)
    || private.parent_join_plan(v_row.student_id, v_row.cadence);
end;
$$;
revoke all on function public.peek_parent_join_link(text) from public;
grant execute on function public.peek_parent_join_link(text) to anon, authenticated;

-- A parent uses the link: linked to the child, once. Asking again with the
-- same link (a reload, back from Stripe) answers the same while the link to
-- the child still stands; a child who unlinked the parent is not re-linked.
-- The rest is link_child_by_code's: parents only, students only, a pending
-- email invite for the pair is accepted, and the child is told.
create or replace function public.redeem_parent_join_link(_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  v_parent uuid := auth.uid();
  v_parent_role public.profile_role;
  v_student_role public.profile_role;
  v_row public.parent_join_links%rowtype;
  v_added int;
  v_parent_name text;
begin
  if v_parent is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select p.role into v_parent_role from public.profiles p where p.id = v_parent;
  if v_parent_role is distinct from 'parent'::public.profile_role then
    return jsonb_build_object('status', 'not_a_parent');
  end if;

  -- Locked, so two parents pressing at the same moment can't both use it.
  select * into v_row from public.parent_join_links l
   where l.token_hash = private.parent_join_token_hash(_token)
   for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_row.used_at is not null then
    if v_row.used_by = v_parent and exists (
      select 1 from public.parent_student_links k
       where k.parent_id = v_parent and k.student_id = v_row.student_id
    ) then
      return jsonb_build_object('status', 'already_linked', 'student_id', v_row.student_id)
        || private.parent_join_plan(v_row.student_id, v_row.cadence);
    end if;
    return jsonb_build_object('status', 'used');
  end if;

  if v_row.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;

  select p.role into v_student_role from public.profiles p where p.id = v_row.student_id;
  if v_student_role is distinct from 'student'::public.profile_role or v_row.student_id = v_parent then
    return jsonb_build_object('status', 'not_found');
  end if;

  insert into public.parent_student_links (parent_id, student_id)
  values (v_parent, v_row.student_id)
  on conflict (parent_id, student_id) do nothing;
  get diagnostics v_added = row_count;

  update public.parent_join_links
     set used_at = now(), used_by = v_parent
   where id = v_row.id;

  if v_added > 0 then
    update public.parent_link_invites
       set status = 'accepted', responded_at = now(), responded_by = v_parent
     where student_id = v_row.student_id
       and status = 'pending'
       and parent_email = lower(coalesce(auth.jwt() ->> 'email', ''));

    select coalesce(nullif(btrim(p.display_name), ''), 'Your parent/guardian')
      into v_parent_name
    from public.profiles p where p.id = v_parent;

    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_row.student_id, 'parent_invite', 'Parent linked to your account',
      v_parent_name || ' linked to your account using your link.', '/parents'
    );
  end if;

  return jsonb_build_object(
      'status', case when v_added > 0 then 'linked' else 'already_linked' end,
      'student_id', v_row.student_id)
    || private.parent_join_plan(v_row.student_id, v_row.cadence);
end;
$$;
revoke all on function public.redeem_parent_join_link(text) from public, anon;
grant execute on function public.redeem_parent_join_link(text) to authenticated;

-- The student's screen asks this while it waits: has my link been used?
create or replace function public.parent_join_link_status(_token text)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $$
declare
  v_row public.parent_join_links%rowtype;
begin
  select * into v_row from public.parent_join_links l
   where l.token_hash = private.parent_join_token_hash(_token)
     and l.student_id = auth.uid();
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_row.used_at is not null then
    return jsonb_build_object(
      'status', 'joined',
      'parent_name', (select nullif(btrim(p.display_name), '')
                        from public.profiles p where p.id = v_row.used_by));
  end if;
  if v_row.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  return jsonb_build_object('status', 'waiting', 'expires_at', v_row.expires_at);
end;
$$;
revoke all on function public.parent_join_link_status(text) from public, anon;
grant execute on function public.parent_join_link_status(text) to authenticated;
