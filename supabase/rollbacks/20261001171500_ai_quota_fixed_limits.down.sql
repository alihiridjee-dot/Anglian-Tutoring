-- Hand-run rollback for 20261001171500_ai_quota_fixed_limits.sql: the two
-- functions as they were live on 1 Oct 2026, and no prune job.

select cron.unschedule('prune-ai-request-log')
 where exists (select 1 from cron.job where jobname = 'prune-ai-request-log');

create or replace function public.claim_ai_request(_endpoint text, _limit integer, _window interval)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _uid uuid := auth.uid();
  _used int;
begin
  if _uid is null then
    raise exception 'not signed in';
  end if;
  if _limit <= 0 then
    return false;
  end if;

  select count(*) into _used
  from ai_request_log
  where user_id = _uid
    and endpoint = _endpoint
    and created_at > now() - _window;

  if _used >= _limit then
    return false;
  end if;

  insert into ai_request_log (user_id, endpoint) values (_uid, _endpoint);
  return true;
end
$function$;

create or replace function public.invite_parent_by_email(_email text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
$function$;
