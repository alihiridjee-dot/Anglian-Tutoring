-- S-1: a per-IP limit on free-trial code requests.
--
-- The trial-code function had only a cooldown per address and an hourly cap
-- shared by everyone, so about 100 junk requests an hour switched the trial off
-- for real visitors. Each request now also counts against the address it came
-- from (Cloudflare's cf-connecting-ip), at most a handful an hour.
--
-- Only a hash of the address is stored, and nothing older than an hour is
-- kept: each claim prunes the rest. Nobody but the function (service role)
-- reads or writes it.
create table if not exists public.trial_code_requests (
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists trial_code_requests_ip_idx
  on public.trial_code_requests (ip_hash, created_at);

alter table public.trial_code_requests enable row level security;
revoke all on public.trial_code_requests from anon, authenticated;

-- True if this address may ask for a code now, counting this request. The
-- lock makes a burst from one address count one at a time, so it can't race
-- past the limit.
create or replace function public.claim_trial_code_request(_ip_hash text, _limit integer)
 returns boolean
 language plpgsql
 volatile security definer
 set search_path to ''
as $function$
declare
  _used integer;
begin
  perform pg_advisory_xact_lock(hashtext('trial_code_requests:' || _ip_hash));
  delete from public.trial_code_requests where created_at < now() - interval '1 hour';
  select count(*) into _used from public.trial_code_requests where ip_hash = _ip_hash;
  if _used >= _limit then
    return false;
  end if;
  insert into public.trial_code_requests (ip_hash) values (_ip_hash);
  return true;
end;
$function$;

revoke all on function public.claim_trial_code_request(text, integer) from public;
revoke all on function public.claim_trial_code_request(text, integer) from anon;
revoke all on function public.claim_trial_code_request(text, integer) from authenticated;
grant execute on function public.claim_trial_code_request(text, integer) to service_role;
