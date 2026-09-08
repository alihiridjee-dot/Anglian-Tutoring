-- Conversations expire 30 days after the last message.
--
-- Messaging is a "catch me on this now" surface, not an archive: a question and
-- its answer are worth reading while the student is still working on the thing
-- they asked about. A month covers that with room to spare — half a term of
-- looking back at what a tutor said — while keeping the table from growing
-- without bound and keeping the amount of student writing we hold small.
--
-- Deletion is by thread, not by message, so a conversation is never left as an
-- amputated half — either the whole exchange is here or none of it is. It also
-- keeps the rule legible on the row the UI already sorts by: last_message_at is
-- bumped by the fan-out trigger on every message, and is set to now() when the
-- thread is created, so a thread nobody ever wrote into also ages out.
--
-- The 24-hour mark is a separate, purely visual thing: the inbox tucks quiet
-- threads into a collapsed group so the list shows what is live. That is the UI
-- minimising them, not the database losing them — nothing is deleted until the
-- month is up.
--
-- Note the tension with the original design of this table, which deliberately
-- gave chat_messages no UPDATE or DELETE policy so that neither party could
-- rewrite history. That still holds for clients: this is a scheduled sweep
-- running as the cron role, and nothing here lets a student or tutor delete a
-- conversation early or edit what was said.
create or replace function public.expire_stale_chat_threads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _deleted integer;
begin
  delete from chat_threads
  where last_message_at < now() - interval '30 days';
  get diagnostics _deleted = row_count;
  return _deleted;
end
$$;

-- Only the scheduler calls this. PostgREST exposes everything in `public`, and
-- a SECURITY DEFINER function that deletes conversations is not something to
-- leave callable at /rest/v1/rpc/.
revoke all on function public.expire_stale_chat_threads() from public, anon, authenticated;

-- Daily at 03:20 UTC, alongside the other retention sweeps. A day's slack either
-- side of the thirtieth is immaterial at this horizon, and the quiet hour keeps
-- the delete away from the evening homework peak. Unschedule any prior job of
-- the same name first so re-running this migration is idempotent.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'expire-stale-chat-threads') then
    perform cron.unschedule('expire-stale-chat-threads');
  end if;
  perform cron.schedule(
    'expire-stale-chat-threads',
    '20 3 * * *',
    $cron$select public.expire_stale_chat_threads();$cron$
  );
end;
$$;
