-- Throttle invite-code redemption, so the code can't be brute-forced.
--
-- `link_child_by_code` links a parent to a child on possession of the child's
-- invite code alone — that is the whole authorisation. At ~40 bits the code is
-- not guessable over HTTP today, but nothing stopped an authenticated parent
-- account from calling the RPC in an unbounded loop, and the code length is the
-- kind of thing that gets shortened later for readability without anyone
-- re-checking this maths. A successful guess links a stranger to a child's
-- account and everything in it, so the throttle goes in now while the RPC is
-- the only door.
--
-- The counter is the same durable, race-safe limiter the AI endpoints use
-- (`claim_ai_request` writing to `ai_request_log`): it lives in the database so
-- a serverless instance cycling can't reset it, the check and the insert are one
-- statement so two racing calls can't both slip through, and the log is not
-- client-writable so a parent can't delete their own attempts to reset the
-- window. Ten attempts an hour is far more than a real parent entering codes for
-- their children needs, and leaves brute force at ~10^11 hours.
--
-- The throttle sits AFTER the parent-role gate: only a parent account can ever
-- link, so only a parent account can guess, and counting non-parent noise would
-- just hand a way to lock a parent out. A throttled call returns a status the UI
-- explains, matching the function's other non-raising outcomes.

create or replace function public.link_child_by_code(_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_parent uuid := auth.uid();
  v_code text := upper(btrim(coalesce(_code, '')));
  v_parent_role public.profile_role;
  v_student uuid;
  v_student_role public.profile_role;
  v_student_name text;
  v_parent_name text;
begin
  if v_parent is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if length(v_code) = 0 then
    raise exception 'Enter an invite code' using errcode = '22023';
  end if;

  -- Gate on the role in the data, never on who the caller claims to be.
  select p.role into v_parent_role from public.profiles p where p.id = v_parent;
  if v_parent_role is distinct from 'parent'::public.profile_role then
    return jsonb_build_object('status', 'not_a_parent');
  end if;

  -- Every code a parent submits counts against a durable per-hour quota. This is
  -- what turns an unbounded guessing loop into ten tries an hour. It sits before
  -- the lookup so a wrong guess is as expensive as a right one.
  if not public.claim_ai_request('link_child_by_code', 10, interval '1 hour') then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  select p.id, p.role into v_student, v_student_role
  from public.profiles p
  where p.student_invite_code = v_code;

  -- No such code, or it belongs to a non-student account. Same answer either
  -- way so this can't be used to probe other people's codes.
  if v_student is null or v_student_role is distinct from 'student'::public.profile_role then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_student = v_parent then
    return jsonb_build_object('status', 'not_found');
  end if;

  if exists (
    select 1 from public.parent_student_links l
    where l.parent_id = v_parent and l.student_id = v_student
  ) then
    return jsonb_build_object('status', 'already_linked', 'student_id', v_student);
  end if;

  insert into public.parent_student_links (parent_id, student_id)
  values (v_parent, v_student)
  on conflict (parent_id, student_id) do nothing;

  -- Any pending email invite for this pair is now moot — mark it accepted so it
  -- stops showing as actionable on either side.
  update public.parent_link_invites
     set status = 'accepted', responded_at = now(), responded_by = v_parent
   where student_id = v_student
     and status = 'pending'
     and parent_email = lower(coalesce(auth.jwt() ->> 'email', ''));

  select coalesce(nullif(btrim(p.display_name), ''), 'Your parent/guardian')
    into v_parent_name
  from public.profiles p where p.id = v_parent;

  select coalesce(nullif(btrim(p.display_name), ''), 'your child')
    into v_student_name
  from public.profiles p where p.id = v_student;

  -- Tell the student someone linked with their code, so an unexpected link is
  -- visible rather than silent.
  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_student, 'parent_invite', 'Parent linked to your account',
    v_parent_name || ' linked to your account using your invite code.', '/parents'
  );

  return jsonb_build_object('status', 'linked', 'student_id', v_student, 'student_name', v_student_name);
end;
$$;

revoke all on function public.link_child_by_code(text) from public, anon;
grant execute on function public.link_child_by_code(text) to authenticated;
