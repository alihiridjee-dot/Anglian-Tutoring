-- Tutor student management: the data the /students pages need and the writes
-- they make.
--
-- A tutor could already read almost everything about a student — enrolments,
-- attempts, submissions, attendance, the plan, the subscription row — but the
-- Students page was a list of names, and the few things it could not reach
-- were the ones a tutor running the business actually asks for: who this is
-- (email), which parent is linked, and the levers to change a wrong level or
-- board, keep a private note, and end a plan. This migration adds exactly
-- those, and nothing a tutor did not have before is opened to anyone else.
--
--   profiles tutor read         put on record: it has been live in production
--                               since the tutor pages shipped, but was added in
--                               the dashboard and exists in no migration
--   tutor_student_directory     RPC: the roster with email and last sign-in,
--                               tutor-only; the only tutor path to auth.users
--   tutor_set_student_level     RPC: change one student's exam level. An RPC
--                               rather than an UPDATE policy on profiles so the
--                               tutor's write reaches one column, not the name,
--                               phone or photo
--   enrolments tutor update     policy: board and grades on a student's enrolment
--   student_tutor_notes         private notes on a student. Tutors only —
--                               neither the student nor a parent can read them
--   billing feedback insert     the tutor arm, mirroring the one added to
--                               assertCanManage in the stripe-checkout function
--
-- Idempotent. Rollback: supabase/rollbacks/20260923081108_tutor_student_management.down.sql

begin;

-- ── 1 · Codify the drifted policy ─────────────────────────────────────────

drop policy if exists "profiles tutor read" on public.profiles;
create policy "profiles tutor read" on public.profiles
  for select to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::public.app_role));

-- ── 2 · The roster, with email ────────────────────────────────────────────

-- Runs as definer so it can join auth.users; refuses anyone who is not staff
-- before it reads a row. Students' emails are personal data about minors, so
-- this is the one place a tutor can see them, and it is not granted to anon.
create or replace function public.tutor_student_directory()
returns table (
  id                      uuid,
  email                   text,
  display_name            text,
  level                   public.level,
  school                  text,
  student_invite_code     text,
  created_at              timestamptz,
  last_sign_in_at         timestamptz,
  onboarding_completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    private.has_role(auth.uid(), 'tutor'::public.app_role)
    or private.has_role(auth.uid(), 'admin'::public.app_role)
  ) then
    raise exception 'Tutor access required' using errcode = '42501';
  end if;

  return query
    select p.id, u.email::text, p.display_name, p.level, p.school,
           p.student_invite_code, p.created_at, u.last_sign_in_at,
           p.onboarding_completed_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role = 'student'::public.profile_role
    order by coalesce(nullif(btrim(p.display_name), ''), u.email);
end;
$$;

revoke all on function public.tutor_student_directory() from public, anon;
grant execute on function public.tutor_student_directory() to authenticated;

-- ── 3 · Level ─────────────────────────────────────────────────────────────

create or replace function public.tutor_set_student_level(_student_id uuid, _level public.level)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    private.has_role(auth.uid(), 'tutor'::public.app_role)
    or private.has_role(auth.uid(), 'admin'::public.app_role)
  ) then
    raise exception 'Tutor access required' using errcode = '42501';
  end if;

  update public.profiles
     set level = _level
   where id = _student_id
     and role = 'student'::public.profile_role;

  if not found then
    raise exception 'No student with that id' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.tutor_set_student_level(uuid, public.level) from public, anon;
grant execute on function public.tutor_set_student_level(uuid, public.level) to authenticated;

-- ── 4 · Board and grades ──────────────────────────────────────────────────

-- Every column on an enrolment row is a tutor's business (board, and the
-- previous / current / target grades), so a plain policy is enough here.
-- Adding or removing a subject stays with the student and the billing
-- function: the row count is what the plan is priced on.
drop policy if exists "enrolments tutor update" on public.student_enrolments;
create policy "enrolments tutor update" on public.student_enrolments
  for update to authenticated
  using (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    or private.has_role((select auth.uid()), 'admin'::public.app_role)
  )
  with check (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    or private.has_role((select auth.uid()), 'admin'::public.app_role)
  );

-- ── 5 · Private notes ─────────────────────────────────────────────────────

create table if not exists public.student_tutor_notes (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  author_id  uuid not null references auth.users(id) on delete cascade,
  body       text not null check (btrim(body) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.student_tutor_notes is
  'A tutor''s private notes on a student. Staff only: no student or parent policy, on purpose.';

create index if not exists student_tutor_notes_student_idx
  on public.student_tutor_notes (student_id, created_at desc);

alter table public.student_tutor_notes enable row level security;

drop policy if exists "stn tutor" on public.student_tutor_notes;
create policy "stn tutor" on public.student_tutor_notes
  for all to authenticated
  using (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    or private.has_role((select auth.uid()), 'admin'::public.app_role)
  )
  with check (
    author_id = (select auth.uid())
    and (
      private.has_role((select auth.uid()), 'tutor'::public.app_role)
      or private.has_role((select auth.uid()), 'admin'::public.app_role)
    )
  );

create or replace function private.touch_student_tutor_note()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists student_tutor_notes_touch on public.student_tutor_notes;
create trigger student_tutor_notes_touch
  before update on public.student_tutor_notes
  for each row execute function private.touch_student_tutor_note();

-- ── 6 · Billing feedback: the tutor arm ───────────────────────────────────

-- The cancel dialog files a reason before it calls Stripe. The insert policy
-- mirrors assertCanManage in supabase/functions/stripe-checkout/auth.ts, which
-- gains the same arm in the same change, so the rule stays one rule.
drop policy if exists "billing feedback insert manager" on public.billing_feedback;
create policy "billing feedback insert manager" on public.billing_feedback
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (
      -- the payer, whoever's card the plan actually sits on
      exists (
        select 1 from public.subscriptions s
        where s.student_id = billing_feedback.student_id
          and s.user_id = auth.uid()
      )
      or exists (
        select 1 from public.parent_student_links l
        where l.parent_id = auth.uid() and l.student_id = billing_feedback.student_id
      )
      or (
        auth.uid() = billing_feedback.student_id
        and not exists (
          select 1 from public.parent_student_links l
          where l.student_id = billing_feedback.student_id
        )
      )
      -- a tutor, ending or pausing a plan from the student's record
      or private.has_role(auth.uid(), 'tutor'::public.app_role)
      or private.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );

commit;
