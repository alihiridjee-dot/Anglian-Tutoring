-- claim_ai_request: add help_ask, the student search box's "Ask for help"
-- (src/lib/search/helpAsk.functions.ts, PR #193). The quota list is fixed on
-- the server since 20261001171500, so an endpoint missing from it is refused
-- with "Unknown request type" — which is what every Ask for help got.
--
-- Body copied from the live definition (md5 of prosrc matched
-- 20261001171500 on 5 Oct before editing); the only change is the new row.

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
    ('suggest_spec_points',    60, interval '1 hour'),
    ('help_ask',               20, interval '1 hour')
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
