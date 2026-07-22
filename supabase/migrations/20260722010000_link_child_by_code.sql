-- Let an already-registered parent link a child by their invite code.
--
-- Until now a parent could only be linked to a student two ways: by carrying the
-- student's invite code THROUGH sign-up (handle_new_user), or by the student
-- emailing them an invite they accept. A parent who already had an account and
-- was simply handed a code had nowhere to enter it. This closes that gap.
--
-- Trust model: holding the student's invite code IS the authorisation. That's
-- the same thing the sign-up path already assumes — a parent who signs up with
-- the code is linked without any further approval — so entering it from the
-- dashboard grants exactly the same access and no more. The student can rotate
-- the code (rotate_student_invite_code) or unlink (unlink_parent) at any time.
--
-- Non-raising outcomes are returned as a status so the UI can explain itself,
-- matching invite_parent_by_email. 'not_found' deliberately covers both "no
-- such code" and "that code isn't a student's", so the function is not an
-- oracle for which codes map to which kind of account.

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
