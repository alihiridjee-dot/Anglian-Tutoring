-- Account deletion: a tutor schedules a student's account for deletion from the
-- student's record, and seven days later it is deleted for good.
--
-- Until now deletions were done by hand in the Supabase dashboard. That left
-- the student's files in storage, rows in the tables with no foreign key to
-- the account, and (until 20260729170000) a live Stripe subscription.
--
--   day 0   the delete-account edge function (action "schedule") pauses the
--           Stripe plan, bans the login, writes a row here and emails the
--           student, any linked parent or payer, and the tutor
--   day 0-7 a tutor can undo it (action "undo"): login and plan come back
--   day 7   the hourly cron below calls the function (action "purge"), which
--           cancels the plan, deletes the student's own Stripe customer, their
--           files and every row, then the auth user, and sends the last emails
--
--   account_deletions   one row per request. Not a foreign key to the account:
--                       the row must outlive the user it is about. The emails
--                       and name it holds are blanked when the deletion
--                       completes, so what is left is a date and two ids.
--   purge cron          hourly. The function is deployed with verify_jwt off
--                       and "purge" takes no caller: it only ever acts on rows
--                       already scheduled and already due, which only a tutor
--                       can create, so no secret has to live in the database.
--
-- Idempotent. Rollback: supabase/rollbacks/20260923114330_account_deletions.down.sql

begin;

-- ── 1 · The requests ──────────────────────────────────────────────────────

create table if not exists public.account_deletions (
  id                      uuid primary key default gen_random_uuid(),
  student_id              uuid not null,
  requested_by            uuid,
  requested_at            timestamptz not null default now(),
  purge_after             timestamptz not null,
  status                  text not null default 'scheduled'
                            check (status in ('scheduled', 'cancelled', 'completed')),
  -- Who is told, captured at request time: by day 7 the account and its parent
  -- links are gone. [{ "email", "name", "audience": student|parent|staff }].
  notify                  jsonb not null default '[]'::jsonb,
  student_name            text,
  -- The Stripe subscription this request paused, so "undo" resumes exactly the
  -- plan it stopped and nothing the family had paused themselves.
  paused_subscription_id  text,
  cancelled_at            timestamptz,
  cancelled_by            uuid,
  completed_at            timestamptz,
  -- Set while a purge is working on the row, so two runs never both act.
  claimed_at              timestamptz,
  attempts                integer not null default 0,
  last_error              text
);

-- One open request per student.
create unique index if not exists account_deletions_one_open
  on public.account_deletions (student_id)
  where status = 'scheduled';

create index if not exists account_deletions_due
  on public.account_deletions (purge_after)
  where status = 'scheduled';

comment on table public.account_deletions is
  'Student accounts scheduled for deletion. Written only by the delete-account '
  'edge function; tutors read it to show and undo a pending deletion.';

alter table public.account_deletions enable row level security;

-- Tutors read. Nobody writes but the service role: scheduling has to pause
-- Stripe and ban the login in the same step, which only the function can do.
drop policy if exists "account deletions tutor read" on public.account_deletions;
create policy "account deletions tutor read" on public.account_deletions
  for select to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::public.app_role));

-- Supabase's default privileges hand `authenticated` everything on a new
-- table, TRUNCATE included, which RLS does not govern. Read-only is the grant.
revoke all on public.account_deletions from anon;
revoke all on public.account_deletions from authenticated;
grant select on public.account_deletions to authenticated;

-- ── 2 · The day-7 run ─────────────────────────────────────────────────────

select cron.unschedule('purge-deleted-accounts')
where exists (select 1 from cron.job where jobname = 'purge-deleted-accounts');

select cron.schedule(
  'purge-deleted-accounts',
  '15 * * * *',
  $$
  select net.http_post(
    url     := 'https://peohauhwquuvghrpmotf.supabase.co/functions/v1/delete-account',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{"action": "purge"}'::jsonb
  );
  $$
);

commit;
