-- Subject pauses: a recorded hard stop for every subject a student can't use.
--
-- Ali's rule (3 Oct 2026): when a plan is paused, a payment lapses, a plan
-- ends or a subject is removed, that subject's planner stops dead. No week is
-- built, and nothing is added to one, until the student can use the subject
-- again. Pausing never erases anything.
--
-- Until now none of this was recorded. The subscription row is overwritten in
-- place, so nothing said when a stop began or ended, and the planner kept
-- building weeks behind the paywall. On the test account that saved an empty
-- biology week (28 Sept 2026) that was never rebuilt.
--
-- This records each stop per subject: when it began, when it ended, and why.
-- The planner reads it to pick up where it stopped, and a family's own
-- cancellation (a plan they cancelled reaching its end, or a subject they
-- removed) is stamped with when it took effect, so it can be erased after
-- 7 days. Only a family's cancellation is ever stamped. A lapsed card stays a
-- pause even after Stripe gives up on it.
--
-- The record is kept by the database itself. Triggers on subscriptions,
-- enrolments and the subject list re-check the student at the end of every
-- change, however it was made: the app, the Stripe webhook, or a hand edit.
-- An hourly job catches a plan that simply runs out with no write at all.

create table public.student_subject_pauses (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  subject public.subject not null,
  -- Why the subject is stopped now. It is re-read on every check, so a lapsed
  -- payment the family then cancels becomes 'cancelled'.
  reason text not null check (reason in (
    'paused',          -- the family paused the plan
    'payment',         -- a payment failed, or the plan ended without the family cancelling it
    'cancelled',       -- the family cancelled the plan, and it has ended
    'subject_removed', -- the family removed this subject from the plan
    'not_on_plan'      -- enrolled, but the plan doesn't cover this many subjects
  )),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- When a family's cancellation took effect: set only for 'cancelled' and
  -- 'subject_removed', and cleared if the subject comes back first.
  cancelled_at timestamptz,
  constraint student_subject_pauses_ends_after_start check (ended_at is null or ended_at >= started_at),
  constraint student_subject_pauses_cancel_has_reason check (
    (cancelled_at is null) = (reason not in ('cancelled', 'subject_removed'))
  )
);

comment on table public.student_subject_pauses is
  'One row per stop of one subject for one student. ended_at null = stopped now. Written only by private.sync_subject_pauses.';

-- At most one open stop per subject.
create unique index student_subject_pauses_open
  on public.student_subject_pauses (student_id, subject)
  where ended_at is null;

create index student_subject_pauses_history
  on public.student_subject_pauses (student_id, subject, started_at desc);

alter table public.student_subject_pauses enable row level security;

-- Readable by the student, a linked parent and tutors, like the programme it
-- belongs to. Nobody writes it through the API.
create policy "ssp own" on public.student_subject_pauses
  for select to authenticated
  using ((select auth.uid()) = student_id);

create policy "ssp parent" on public.student_subject_pauses
  for select to authenticated
  using (exists (
    select 1 from public.parent_student_links l
    where l.parent_id = (select auth.uid()) and l.student_id = student_subject_pauses.student_id
  ));

create policy "ssp tutor" on public.student_subject_pauses
  for select to authenticated
  using (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    or private.has_role((select auth.uid()), 'admin'::public.app_role)
  );

revoke all on public.student_subject_pauses from anon, authenticated;
grant select on public.student_subject_pauses to authenticated;

-- Tutors are never students (20261003115242): the same guard as every other
-- per-student table.
create trigger student_row_not_staff
  before insert or update of student_id on public.student_subject_pauses
  for each row execute function private.refuse_student_row_for_staff('student_id');

-- Bring one student's stops up to date with what they can use right now.
--
-- A subject is stopped when the student has a programme for it but it isn't
-- among their paid subjects (private.student_paid_subjects, the same rule the
-- content RLS uses). A subject with no programme has nothing to stop.
create or replace function private.sync_subject_pauses(p_student_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _paid text[];
  _access boolean;
  _status text;
  _cancel boolean;
  _period_end timestamptz;
  _since timestamptz := now();
begin
  if p_student_id is null then
    return;
  end if;

  -- One check per student at a time, so two changes landing together can't
  -- both open a stop.
  perform pg_advisory_xact_lock(hashtextextended('subject_pauses:' || p_student_id::text, 0));

  _paid := private.student_paid_subjects(p_student_id);
  _access := private.student_has_access(p_student_id);

  -- The plan that decides it: one giving access if there is one, else the
  -- latest. No row leaves all three null.
  select s.status, s.cancel_at_period_end, s.current_period_end
    into _status, _cancel, _period_end
  from public.subscriptions s
  where s.student_id = p_student_id
  order by (s.status in ('active', 'trialing')) desc, s.updated_at desc
  limit 1;

  -- A plan that simply ran out (still 'active', past its end, no webhook yet)
  -- stopped when it ended, not when this check noticed.
  if not _access and _status in ('active', 'trialing') and _period_end <= now() then
    _since := _period_end;
  end if;

  -- Back on: the subject is paid for again.
  update public.student_subject_pauses p
     set ended_at = greatest(now(), p.started_at)
   where p.student_id = p_student_id
     and p.ended_at is null
     and p.subject::text = any (_paid);

  -- Nothing left to stop: the programme itself is gone.
  update public.student_subject_pauses p
     set ended_at = greatest(now(), p.started_at)
   where p.student_id = p_student_id
     and p.ended_at is null
     and not exists (
       select 1 from public.student_program_plan pp
       where pp.student_id = p_student_id and pp.subject = p.subject
     );

  with stopped as (
    select pp.subject,
           case
             when not exists (
               select 1 from public.student_enrolments e
               where e.student_id = p_student_id and e.subject = pp.subject
             ) then 'subject_removed'
             when _access then 'not_on_plan'
             when _status = 'paused' then 'paused'
             when _status = 'canceled' and _cancel then 'cancelled'
             else 'payment'
           end as reason
    from public.student_program_plan pp
    where pp.student_id = p_student_id
      and not (pp.subject::text = any (_paid))
  ),
  changed as (
    update public.student_subject_pauses p
       set reason = s.reason,
           cancelled_at = case
             when s.reason in ('cancelled', 'subject_removed') then coalesce(p.cancelled_at, now())
           end
      from stopped s
     where p.student_id = p_student_id
       and p.subject = s.subject
       and p.ended_at is null
       and p.reason is distinct from s.reason
    returning p.id
  )
  insert into public.student_subject_pauses (student_id, subject, reason, started_at, cancelled_at)
  select p_student_id, s.subject, s.reason, _since,
         case when s.reason in ('cancelled', 'subject_removed') then _since end
  from stopped s
  where not exists (
    select 1 from public.student_subject_pauses o
    where o.student_id = p_student_id and o.subject = s.subject and o.ended_at is null
  )
  on conflict (student_id, subject) where ended_at is null do nothing;
end;
$function$;

revoke all on function private.sync_subject_pauses(uuid) from public, anon, authenticated;

-- Runs at the end of the transaction (the triggers below are deferred), so it
-- sees the final state of a change made in several steps, such as removing a
-- subject. It must never undo the change it follows: a broken check would
-- otherwise make every Stripe webhook fail. So an error is only a warning,
-- and the hourly job tries again.
create or replace function private.sync_subject_pauses_after_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _new uuid;
  _old uuid;
begin
  _new := (to_jsonb(new) ->> tg_argv[0])::uuid;
  _old := (to_jsonb(old) ->> tg_argv[0])::uuid;
  begin
    perform private.sync_subject_pauses(_new);
    if _old is distinct from _new then
      perform private.sync_subject_pauses(_old);
    end if;
  exception when others then
    raise warning 'sync_subject_pauses failed for % on %: %', coalesce(_new, _old), tg_table_name, sqlerrm;
  end;
  return null;
end;
$function$;

revoke all on function private.sync_subject_pauses_after_change() from public, anon, authenticated;

create constraint trigger subject_pauses_follow_subscription
  after insert or update or delete on public.subscriptions
  deferrable initially deferred
  for each row execute function private.sync_subject_pauses_after_change('student_id');

create constraint trigger subject_pauses_follow_enrolment
  after insert or update or delete on public.student_enrolments
  deferrable initially deferred
  for each row execute function private.sync_subject_pauses_after_change('student_id');

create constraint trigger subject_pauses_follow_courses
  after update of enrolled_courses on public.profiles
  deferrable initially deferred
  for each row execute function private.sync_subject_pauses_after_change('id');

-- No week is built, and nothing is added to one, for a subject the student
-- can't use. This is the hard stop itself, so it reads what the student can
-- use right now rather than the record above, and covers every route in:
-- save_weekly_plan, a point added straight to a week, a tutor's pin.
create or replace function private.refuse_planning_while_paused()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _student uuid;
  _subject public.subject;
begin
  if tg_table_name = 'student_weekly_plans' then
    _student := new.student_id;
    _subject := new.subject;
  else
    select w.student_id, w.subject into _student, _subject
    from public.student_weekly_plans w
    where w.id = new.plan_id;
  end if;

  if _student is not null
     and not (_subject::text = any (private.student_paid_subjects(_student))) then
    raise exception using
      errcode = '23514',
      message = 'This subject is paused, so nothing new can be planned for it.',
      hint = 'subject_paused';
  end if;
  return new;
end;
$function$;

revoke all on function private.refuse_planning_while_paused() from public, anon, authenticated;

create trigger plan_not_while_paused
  before insert on public.student_weekly_plans
  for each row execute function private.refuse_planning_while_paused();

create trigger plan_point_not_while_paused
  before insert or update of plan_id on public.student_weekly_plan_points
  for each row execute function private.refuse_planning_while_paused();

-- The backstop for a plan that runs out with nothing written: every student
-- with a programme, every hour.
select cron.unschedule('sync-subject-pauses')
 where exists (select 1 from cron.job where jobname = 'sync-subject-pauses');

select cron.schedule(
  'sync-subject-pauses',
  '25 * * * *',
  $cron$ select private.sync_subject_pauses(s.student_id) from (select distinct student_id from public.student_program_plan) s; $cron$
);

-- Record anyone already stopped.
select private.sync_subject_pauses(s.student_id)
from (select distinct student_id from public.student_program_plan) s;
