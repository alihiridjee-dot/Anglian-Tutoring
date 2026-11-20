-- claim_ai_request: add chat_draft, the budget for the tutor's "Draft a reply"
-- button in the inbox (generateChatDraft in src/lib/chat/chatDraft.functions.ts).
-- Each press is one Sonnet call over up to twelve messages, and until now it
-- was the one tutor drafting tool with no hourly cap: a stolen or scripted
-- tutor session could spend without limit. Sixty an hour, like the other
-- tutor drafting tools (session_blurb, weekly_summary, weekly_feedback,
-- suggest_spec_points), and its own budget so drafting replies doesn't eat
-- into planning.
--
-- Body copied from 20261028101700_stripe_invoices_quota, which is what is live
-- (md5 of prosrc 0af05a30dae1e4eb5be94abee8f19aa6 on 20 Nov 2026); the only
-- change is the new row. Apply this BEFORE the app change in the same PR
-- ships: until it is live, every draft's claim fails with "Unknown request
-- type" and the tutor is told the hour is used up.
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
    ('help_ask',               20, interval '1 hour'),
    ('question_ideas',         10, interval '1 hour'),
    ('stripe_checkout',        20, interval '1 hour'),
    ('stripe_invoices',        60, interval '1 hour'),
    ('chat_draft',             60, interval '1 hour')
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
