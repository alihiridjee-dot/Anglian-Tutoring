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
--
-- An unanswered question is never swept, however old it gets.
--
-- Age alone was the original rule, and it deletes exactly the wrong thing. The
-- threads most likely to sit untouched for a month are the ones nobody got
-- round to replying to, so the sweep would quietly bin a student's unanswered
-- question and leave no trace that it was ever asked. That is a service failure
-- being tidied away rather than a conversation ageing out, and the tutor is the
-- one person who would have wanted to see it. (Found on the way to applying
-- this: a thread from 4 August asking why potato pieces gain mass in distilled
-- water, still open, never replied to, due for deletion.)
--
-- So the rule is now: a thread is only swept once the tutor has actually said
-- something in it. That is what makes it a conversation rather than an
-- outstanding obligation, and only then does "thirty days after it finished"
-- mean anything.
--
-- `status` is deliberately not used as the test. The column exists but nothing
-- in the application ever writes it — every row is 'open' forever — so gating
-- on it would read as a rule while doing nothing at all.
--
-- The cost is that a question nobody ever answers is kept indefinitely. That is
-- the right way round: the fix for an unanswered thread is a reply or a
-- deliberate deletion, not a timer.
create or replace function public.expire_stale_chat_threads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _deleted integer;
begin
  delete from chat_threads t
  where t.last_message_at < now() - interval '30 days'
    and exists (
      select 1
      from chat_messages m
      where m.thread_id = t.id
        and m.sender_id = t.tutor_id
    );
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
