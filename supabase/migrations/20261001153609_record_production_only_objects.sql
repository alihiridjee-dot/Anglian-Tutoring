-- H-5: record what exists only in production, so the repo is a complete record.
--
-- These objects were created through the dashboard (the July 2026 changes
-- with no migration file) and are used by the app, but no migration defined
-- them. Each statement is copied from the live definition (pg_get_functiondef,
-- pg_attribute, pg_indexes, pg_policies, the ACLs; read 1 Oct 2026) and is
-- written so that applying this to production changes nothing: tables, columns
-- and indexes only "if not exists", policies only when absent, the function
-- replaced with its own body, and grants that are already held.
--
-- Not a fix for a from-scratch replay: earlier migrations already refer to
-- notifications and resource_spec_points, so a fresh database still needs
-- these created before those files run.

-- ── homework_submissions.acknowledged_at and acknowledge_submission() ──────
alter table public.homework_submissions add column if not exists acknowledged_at timestamptz;

create or replace function public.acknowledge_submission(_submission_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  s            record;
  student_name text;
  hw_title     text;
begin
  select * into s from public.homework_submissions where id = _submission_id;
  if not found then
    raise exception 'Submission not found';
  end if;
  if s.student_id <> auth.uid() then
    raise exception 'You can only acknowledge your own submission';
  end if;
  if s.graded_at is null then
    raise exception 'This submission has not been marked yet';
  end if;
  if s.acknowledged_at is not null then
    return; -- already acknowledged; stay idempotent
  end if;

  update public.homework_submissions
     set acknowledged_at = now()
   where id = _submission_id;

  select display_name into student_name from public.profiles where id = s.student_id;
  select title        into hw_title     from public.resources where id = s.resource_id;

  if s.graded_by is not null then
    insert into public.notifications (user_id, type, title, body, link, submission_id)
    values (
      s.graded_by,
      'feedback_acknowledged',
      coalesce(nullif(student_name, ''), 'A student') || ' acknowledged your feedback',
      coalesce(hw_title, 'Homework'),
      '/homework',
      _submission_id
    );
  end if;
end;
$function$;

revoke all on function public.acknowledge_submission(uuid) from public;
revoke all on function public.acknowledge_submission(uuid) from anon;
grant execute on function public.acknowledge_submission(uuid) to authenticated, service_role;

-- ── notifications ──────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  type text not null,
  title text not null,
  body text,
  link text,
  submission_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_pkey primary key (id),
  constraint notifications_user_id_fkey foreign key (user_id)
    references auth.users(id) on delete cascade,
  constraint notifications_submission_id_fkey foreign key (submission_id)
    references public.homework_submissions(id) on delete cascade
);
create index if not exists notifications_user_created_idx
  on public.notifications using btree (user_id, created_at desc);
create index if not exists idx_notifications_submission_id
  on public.notifications using btree (submission_id);
alter table public.notifications enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'notifications' and policyname = 'notifications read own') then
    create policy "notifications read own" on public.notifications
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'notifications' and policyname = 'notifications update own') then
    create policy "notifications update own" on public.notifications
      for update to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end $$;

grant all on public.notifications to anon, authenticated, service_role;

-- ── resource_spec_points ───────────────────────────────────────────────────
create table if not exists public.resource_spec_points (
  resource_id uuid not null,
  spec_point_id uuid not null,
  created_at timestamptz not null default now(),
  constraint resource_spec_points_pkey primary key (resource_id, spec_point_id),
  constraint resource_spec_points_resource_id_fkey foreign key (resource_id)
    references public.resources(id) on delete cascade,
  constraint resource_spec_points_spec_point_id_fkey foreign key (spec_point_id)
    references public.spec_points(id) on delete cascade
);
create index if not exists resource_spec_points_spec_point_idx
  on public.resource_spec_points using btree (spec_point_id);
alter table public.resource_spec_points enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'resource_spec_points' and policyname = 'rsp read follows resource') then
    create policy "rsp read follows resource" on public.resource_spec_points
      for select to authenticated
      using (exists (select 1 from public.resources r where r.id = resource_spec_points.resource_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'resource_spec_points' and policyname = 'rsp tutors write') then
    create policy "rsp tutors write" on public.resource_spec_points
      for all to authenticated
      using (private.has_role((select auth.uid()), 'tutor'::public.app_role))
      with check (private.has_role((select auth.uid()), 'tutor'::public.app_role));
  end if;
end $$;

grant all on public.resource_spec_points to anon, authenticated, service_role;
