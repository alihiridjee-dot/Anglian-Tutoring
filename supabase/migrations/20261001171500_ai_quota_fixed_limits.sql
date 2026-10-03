-- M-16 · claim_ai_request: race-safe, limits fixed on the server, pruned daily.
-- M-14 · invite_parent_by_email: students only, throttled, notifies once.
--
-- Both bodies start from their live definitions (pg_get_functiondef, 1 Oct).

-- ── M-16 ────────────────────────────────────────────────────────────────────
-- It counted and then inserted with no lock, so parallel calls all saw room
-- and all passed. And the endpoint, limit and window came from the caller:
-- any signed-in user could call it straight from the API with a new endpoint
-- name, or a huge limit, and write log rows without end.
--
-- Now each endpoint's quota is fixed here, an unknown endpoint is refused
-- without writing anything, and a per-user, per-endpoint advisory lock makes
-- the count and the insert one step. A caller's own _limit still applies when
-- it is lower; _window is ignored. The signature is unchanged, so the server
-- functions and edge functions that call it need no change.
--
-- The quotas are the ones the callers already pass (src/lib/auth/
-- tutorAi.server.ts, mcq.functions.ts, homeworkQuestions.functions.ts,
-- mark-homework, link_child_by_code), plus invite_parent_by_email below.
create or replace function public.claim_ai_request(_endpoint text, _limit integer, _window interval)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _uid uuid := auth.uid();
  _max int;
  _period interval;
  _used int;
begin
  if _uid is null then
    raise exception 'not signed in';
  end if;

  select q.max_calls, q.period into _max, _period
  from (values
    ('link_child_by_code',     10, interval '1 hour'),
    ('invite_parent_by_email', 10, interval '1 hour'),
    ('mcq_generation',         12, interval '1 hour'),
    ('homework_generation',    12, interval '1 hour'),
    ('homework_marking',       30, interval '1 hour'),
    ('session_blurb',          60, interval '1 hour'),
    ('weekly_summary',         60, interval '1 hour'),
    ('weekly_feedback',        60, interval '1 hour'),
    ('suggest_spec_points',    60, interval '1 hour')
  ) as q(endpoint, max_calls, period)
  where q.endpoint = _endpoint;
  if not found then
    raise exception 'Unknown request type' using errcode = '22023';
  end if;
  _max := least(_max, coalesce(_limit, _max));
  if _max <= 0 then
    return false;
  end if;

  -- One claim at a time per user and endpoint; released at commit.
  perform pg_advisory_xact_lock(hashtextextended('claim_ai_request:' || _uid || ':' || _endpoint, 0));

  select count(*) into _used
  from public.ai_request_log
  where user_id = _uid
    and endpoint = _endpoint
    and created_at > now() - _period;

  if _used >= _max then
    return false;
  end if;

  insert into public.ai_request_log (user_id, endpoint) values (_uid, _endpoint);
  return true;
end
$function$;

revoke all on function public.claim_ai_request(text, integer, interval) from public, anon;
grant execute on function public.claim_ai_request(text, integer, interval) to authenticated, service_role;

-- The prune existed but nothing ran it. Every quota is an hour or less, and it
-- keeps a day.
select cron.unschedule('prune-ai-request-log')
 where exists (select 1 from cron.job where jobname = 'prune-ai-request-log');

select cron.schedule('prune-ai-request-log', '40 3 * * *', $cron$ select public.prune_ai_request_log(); $cron$);


-- ── M-14 ────────────────────────────────────────────────────────────────────
-- Any account could call it over and over, each call added another
-- notification for the parent, and the caller wasn't checked to be a student.
-- Its answers (no account / not a parent) also say whether an email has an
-- account here, so the quota sits before that lookup.
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
  v_new_invite boolean;
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

  -- Gate on the role in the data, as link_child_by_code does.
  if not exists (
    select 1 from public.profiles p
    where p.id = v_student and p.role = 'student'::public.profile_role
  ) then
    return jsonb_build_object('status', 'not_a_student');
  end if;

  if not public.claim_ai_request('invite_parent_by_email', 10, interval '1 hour') then
    return jsonb_build_object('status', 'rate_limited');
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
  -- stacking duplicates. xmax = 0 only on a freshly inserted row.
  insert into public.parent_link_invites (student_id, parent_email)
  values (v_student, v_email)
  on conflict (student_id, parent_email) where status = 'pending'
  do update set expires_at = now() + interval '14 days', created_at = now()
  returning id, (xmax = 0) into v_invite_id, v_new_invite;

  -- The parent hears about an invite once, not on every resend.
  if v_new_invite then
    select coalesce(nullif(btrim(p.display_name), ''), 'A student')
      into v_student_name
    from public.profiles p where p.id = v_student;

    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_parent, 'parent_invite', 'Parent access request',
      v_student_name || ' has invited you to follow their progress.', '/parents'
    );
  end if;

  return jsonb_build_object('status', 'invited', 'invite_id', v_invite_id);
end;
$function$;

revoke all on function public.invite_parent_by_email(text) from public, anon;
grant execute on function public.invite_parent_by_email(text) to authenticated, service_role;
