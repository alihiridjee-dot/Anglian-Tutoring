-- New-student alert: the team gets an email when a student finishes setting
-- up their account.
--
--   new_student_alerts   one row per student, ever: the primary key is the
--                        student, so finishing setup twice can't send twice.
--                        Ids and times only. The email itself is written by
--                        the new-student-alert edge function from the profile.
--   the trigger          when a student's onboarding_completed_at is first
--                        set, adds the row and calls the function. It can
--                        never stop setup finishing: any failure is a warning.
--   the cron             every 15 minutes, only while a row is still unsent,
--                        calls the function again. That is the retry.
--
-- The function is deployed with verify_jwt off and takes no caller: it only
-- emails rows already here, always to the one team inbox, so no secret has to
-- live in the database (the same reasoning as purge-deleted-accounts).
--
-- Students who finished setup before this migration get no email.
--
-- Idempotent. Rollback: supabase/rollbacks/20261125140000_new_student_alerts.down.sql

begin;

-- ── 1 · The queue ─────────────────────────────────────────────────────────

create table if not exists public.new_student_alerts (
  student_id  uuid primary key references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  attempts    smallint not null default 0,
  sent_at     timestamptz
);

comment on table public.new_student_alerts is
  'One row per student who finished setup; the new-student-alert function emails the team and stamps sent_at.';

alter table public.new_student_alerts enable row level security;
-- No policies: only the service role (the edge function) reads or writes it.
revoke all on public.new_student_alerts from public, anon, authenticated;

-- ── 2 · Noticing a new student ────────────────────────────────────────────

create or replace function private.queue_new_student_alert()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  begin
    insert into public.new_student_alerts (student_id)
    values (new.id)
    on conflict (student_id) do nothing;

    if found then
      -- pg_net sends this once the transaction commits, so the function
      -- finds the row.
      perform net.http_post(
        url     := 'https://peohauhwquuvghrpmotf.supabase.co/functions/v1/new-student-alert',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body    := '{}'::jsonb
      );
    end if;
  exception when others then
    -- An email is never worth a student's setup failing.
    raise warning 'queue_new_student_alert: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$function$;

revoke all on function private.queue_new_student_alert() from public, anon, authenticated;

drop trigger if exists profiles_new_student_alert on public.profiles;
create trigger profiles_new_student_alert
  after update of onboarding_completed_at on public.profiles
  for each row
  when (
    old.onboarding_completed_at is null
    and new.onboarding_completed_at is not null
    and new.role = 'student'
  )
  execute function private.queue_new_student_alert();

-- ── 3 · The retry ─────────────────────────────────────────────────────────

select cron.unschedule('new-student-alerts')
where exists (select 1 from cron.job where jobname = 'new-student-alerts');

select cron.schedule(
  'new-student-alerts',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url     := 'https://peohauhwquuvghrpmotf.supabase.co/functions/v1/new-student-alert',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  )
  where exists (
    select 1 from public.new_student_alerts a
    where a.sent_at is null
      and a.attempts < 5
      and (a.claimed_at is null or a.claimed_at < now() - interval '10 minutes')
  );
  $cron$
);

commit;
