-- Workstream 03: who may change a plan, and changing one at a time.
--
-- M-5. add_subjects read a student's enrolments, priced the plan from that
-- read, then wrote enrolled_courses from it too. A parent and child adding
-- different subjects at the same moment each priced "one more" and each wrote
-- their own list: paying for 2, enrolled in 3, with access to 2. Two pieces:
--
--   • a short lease per student, taken by stripe-checkout before it reads
--     anything for add_subjects, remove_subjects or change_cadence, so a second
--     change waits for the first rather than racing it. It lapses after two
--     minutes in case a run dies holding it.
--   • apply_enrolment_change, which writes the enrolment rows and recomputes
--     enrolled_courses (the RLS grant) from them in one transaction, under a
--     per-student lock. The grant can no longer drift from the rows.
--
-- Both are for the edge function only (service role).
create table if not exists public.billing_change_leases (
  student_id uuid primary key,
  taken_at timestamptz not null default now()
);
alter table public.billing_change_leases enable row level security;
revoke all on public.billing_change_leases from anon, authenticated;

create or replace function public.take_billing_lease(_student_id uuid)
 returns boolean
 language sql
 volatile security definer
 set search_path to ''
as $function$
  with taken as (
    insert into public.billing_change_leases as l (student_id, taken_at)
    values (_student_id, now())
    on conflict (student_id) do update
      set taken_at = now()
      where l.taken_at < now() - interval '2 minutes'
    returning 1
  )
  select exists (select 1 from taken)
$function$;

create or replace function public.release_billing_lease(_student_id uuid)
 returns void
 language sql
 volatile security definer
 set search_path to ''
as $function$
  delete from public.billing_change_leases where student_id = _student_id
$function$;

-- Adds (or re-boards) the given subjects and removes the others named, then
-- sets enrolled_courses to exactly the enrolled subjects. Order matters there:
-- private.student_paid_subjects grants the first N, so subjects already on the
-- list keep their places and new ones go on the end. Returns the new list.
create or replace function public.apply_enrolment_change(
  _student_id uuid,
  _add jsonb,
  _remove text[]
)
 returns text[]
 language plpgsql
 volatile security definer
 set search_path to ''
as $function$
declare
  _before text[];
  _after text[];
begin
  perform pg_advisory_xact_lock(hashtext('enrolments:' || _student_id::text));

  select coalesce(p.enrolled_courses, '{}'::text[]) into _before
    from public.profiles p where p.id = _student_id
    for update;
  if not found then
    raise exception 'No such student';
  end if;

  if coalesce(cardinality(_remove), 0) > 0 then
    delete from public.student_enrolments
     where student_id = _student_id
       and subject::text = any (_remove);
  end if;

  insert into public.student_enrolments (student_id, subject, board)
  select _student_id, (e ->> 'subject')::public.subject, (e ->> 'board')::public.board
    from jsonb_array_elements(coalesce(_add, '[]'::jsonb)) e
  on conflict (student_id, subject) do update set board = excluded.board;

  select coalesce(array_agg(s order by coalesce(array_position(_before, s), 1000), s), '{}'::text[])
    into _after
    from (select e.subject::text as s
            from public.student_enrolments e
           where e.student_id = _student_id) q;

  update public.profiles set enrolled_courses = _after where id = _student_id;
  return _after;
end;
$function$;

revoke all on function public.take_billing_lease(uuid) from public, anon, authenticated;
revoke all on function public.release_billing_lease(uuid) from public, anon, authenticated;
revoke all on function public.apply_enrolment_change(uuid, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.take_billing_lease(uuid) to service_role;
grant execute on function public.release_billing_lease(uuid) to service_role;
grant execute on function public.apply_enrolment_change(uuid, jsonb, text[]) to service_role;

-- S-2. A student could manage their own plan whenever no parent was linked,
-- whoever paid for it, so a child who unlinked the parent paying could then
-- pause, cancel, drop subjects or switch cadence on that parent's card. The
-- server's rule (stripe-checkout assertCanManage) now lets a student manage only
-- a plan they pay for, or a legacy one with no payer recorded while no parent
-- is linked. This policy mirrors it; started from the live definition, only the
-- student's arm changes.
drop policy if exists "billing feedback insert manager" on public.billing_feedback;
create policy "billing feedback insert manager" on public.billing_feedback
  for insert to authenticated
  with check (
    (auth.uid() = user_id)
    and (
      (exists (
        select 1 from public.subscriptions s
         where s.student_id = billing_feedback.student_id and s.user_id = auth.uid()
      ))
      or (exists (
        select 1 from public.parent_student_links l
         where l.parent_id = auth.uid() and l.student_id = billing_feedback.student_id
      ))
      or (
        auth.uid() = student_id
        and not exists (
          select 1 from public.parent_student_links l
           where l.student_id = billing_feedback.student_id
        )
        and not exists (
          select 1 from public.subscriptions s
           where s.student_id = billing_feedback.student_id
             and s.user_id is not null
             and s.user_id <> auth.uid()
        )
      )
      or private.has_role(auth.uid(), 'tutor'::public.app_role)
      or private.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );
