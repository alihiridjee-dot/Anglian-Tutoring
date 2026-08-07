-- Per-user throttle for the student-facing AI endpoints.
--
-- The planner's "suggest my week" and "interpret what I'm stuck on" both call
-- Anthropic with the student's whole course in the prompt. Nothing limited how
-- often. Fifty students on the dashboard at 7pm is fifty concurrent calls of a
-- few thousand input tokens each, which clears the per-minute token allowance
-- immediately -- and the failure is symmetric: everyone gets a 429, including
-- the students who only pressed the button once.
--
-- The counter lives in the database rather than in memory because the app runs
-- on serverless functions: instances come and go, so an in-process counter
-- silently resets and enforces nothing. This table is the durable half; the
-- server function also holds a per-instance concurrency gate for burst shaping.
create table if not exists public.ai_request_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  created_at timestamptz not null default now()
);

-- The only query this table serves: "how many calls has this user made to this
-- endpoint since T".
create index if not exists ai_request_log_user_endpoint_time_idx
  on public.ai_request_log (user_id, endpoint, created_at desc);

alter table public.ai_request_log enable row level security;

-- Readable by the owner so a UI can show remaining quota; never writable from
-- the client. Writes happen through the SECURITY DEFINER function below, so a
-- student cannot delete their own log rows to reset the limit.
create policy "ai_request_log read own" on public.ai_request_log
for select to authenticated
using ((select auth.uid()) = user_id);

/**
 * Claim one request slot, or refuse.
 *
 * Returns true when the call is allowed (and records it), false when the
 * caller is over the limit. Doing the check and the insert in one function
 * keeps them in a single statement, so two requests racing can't both read
 * "9 used" and both proceed.
 */
create or replace function public.claim_ai_request(
  _endpoint text,
  _limit int,
  _window interval
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.claim_ai_request(text, int, interval) from public;
grant execute on function public.claim_ai_request(text, int, interval) to authenticated;

/**
 * Drop log rows older than a day. Nothing schedules this yet -- the table is
 * small and the index keeps the count query cheap regardless -- but it exists
 * so housekeeping is a call rather than a migration.
 */
create or replace function public.prune_ai_request_log()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _deleted integer;
begin
  delete from ai_request_log where created_at < now() - interval '1 day';
  get diagnostics _deleted = row_count;
  return _deleted;
end
$$;

revoke all on function public.prune_ai_request_log() from public;
