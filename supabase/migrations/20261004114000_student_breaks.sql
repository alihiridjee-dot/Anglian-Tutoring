-- Breaks: a student can stop their work for a while without touching the
-- plan they pay for (PR 1 of the break work).
--
-- Ali's rule (4 Oct 2026): a student going on holiday, or with too much school
-- work, can take a break. Billing and access carry on as normal. While the
-- break runs no new work is set, and nothing in those weeks counts as missed.
-- When it ends, the rest of the course is spread over the weeks left before
-- the exam, as it is after a billing pause. The planner does that part, in a
-- later change.
--
-- A break is whole UK weeks, Monday to Sunday, one to four of them in a row.
-- Breaks that touch count as one, so two can't be chained past four weeks.
-- None may fall in the 6 weeks before an exam, or in the exam week. A break
-- can start this week or later, never in a week that has gone.
--
-- The student, a linked parent or a tutor can book one, and the same people
-- can call it off. A linked parent is always told, unless they booked it
-- themselves, and so is the student when someone else booked it. Coming back
-- early makes the week they came back in a working week again.
--
-- This is not a billing pause. Those are kept per subject in
-- student_subject_pauses, and that record follows the subscription: it closes
-- any stop as soon as the subject is paid for, so it would end a break at
-- once. A break covers every subject the student has.
--
-- Written only by book_break and end_break. A family's cancellation erases
-- the student's breaks with the rest of their progress.

create table public.student_breaks (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  -- The Monday it starts and the Sunday it ends. Coming back early moves
  -- ends_on back to the Sunday before the week they came back in.
  starts_on date not null,
  ends_on date not null,
  reason text not null check (reason in ('holiday', 'school', 'exams', 'other')),
  booked_by uuid references auth.users(id) on delete set null,
  booked_at timestamptz not null default now(),
  -- Called off before a whole week of it had passed. A cancelled break is
  -- ignored everywhere.
  cancelled_at timestamptz,
  -- Cut short by coming back early.
  ended_early_at timestamptz,
  -- Who called it off or cut it short.
  ended_by uuid references auth.users(id) on delete set null,
  constraint student_breaks_whole_weeks check (
    extract(isodow from starts_on) = 1 and extract(isodow from ends_on) = 7
  ),
  constraint student_breaks_one_to_four_weeks check (ends_on - starts_on + 1 between 7 and 28)
);

comment on table public.student_breaks is
  'Breaks from study a student, parent or tutor booked: whole weeks, starts_on (Monday) to ends_on (Sunday). cancelled_at set = never happened. Written only by book_break and end_break.';

create index student_breaks_by_student on public.student_breaks (student_id, starts_on);

alter table public.student_breaks enable row level security;

-- Readable by the student, a linked parent and tutors, like the programme it
-- belongs to. Nobody writes it through the API.
create policy "sb own" on public.student_breaks
  for select to authenticated
  using ((select auth.uid()) = student_id);

create policy "sb parent" on public.student_breaks
  for select to authenticated
  using (exists (
    select 1 from public.parent_student_links l
    where l.parent_id = (select auth.uid()) and l.student_id = student_breaks.student_id
  ));

create policy "sb tutor" on public.student_breaks
  for select to authenticated
  using (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    or private.has_role((select auth.uid()), 'admin'::public.app_role)
  );

revoke all on public.student_breaks from anon, authenticated;
grant select on public.student_breaks to authenticated;

-- Tutors are never students (20261003115242): the same guard as every other
-- per-student table.
create trigger student_row_not_staff
  before insert or update of student_id on public.student_breaks
  for each row execute function private.refuse_student_row_for_staff('student_id');

-- Who may book or change a student's breaks: the student, a linked parent, or
-- a tutor.
create or replace function private.may_manage_breaks(p_student_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select (select auth.uid()) = p_student_id
      or exists (
        select 1 from public.parent_student_links l
        where l.parent_id = (select auth.uid()) and l.student_id = p_student_id
      )
      or public.plan_override_caller_is_tutor();
$function$;

revoke all on function private.may_manage_breaks(uuid) from public, anon, authenticated;

-- Book a break of _weeks whole weeks from the Monday _starts_on. Returns its id.
create or replace function public.book_break(
  _student_id uuid,
  _starts_on date,
  _weeks integer,
  _reason text
)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _caller uuid := (select auth.uid());
  _this_week date := date_trunc('week', now() at time zone 'Europe/London')::date;
  _ends_on date;
  _run_from date;
  _run_to date;
  _edge date;
  _exam date;
  _id uuid;
  _name text;
  _by_tutor boolean;
  _when text;
begin
  if _caller is null then
    raise exception 'Sign in to book a break.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = _student_id and p.role = 'student') then
    raise exception 'Only a student can take a break.' using errcode = '22023';
  end if;
  if not private.may_manage_breaks(_student_id) then
    raise exception 'Only the student, their parent or a tutor can book a break.'
      using errcode = '42501';
  end if;
  if _reason is null or _reason not in ('holiday', 'school', 'exams', 'other') then
    raise exception 'Pick a reason for the break.' using errcode = '22023';
  end if;
  if _weeks is null or _weeks not between 1 and 4 then
    raise exception 'A break is 1 to 4 weeks.' using errcode = '23514', hint = 'break_too_long';
  end if;
  if _starts_on is null or extract(isodow from _starts_on) <> 1 then
    raise exception 'A break starts on a Monday.' using errcode = '22023';
  end if;
  if _starts_on < _this_week then
    raise exception 'A break can''t start in a week that has already gone.' using errcode = '22023';
  end if;
  if _starts_on > _this_week + 364 then
    raise exception 'A break can be booked up to a year ahead.' using errcode = '22023';
  end if;
  _ends_on := _starts_on + 7 * _weeks - 1;

  -- One booking at a time per student, so two at once can't overlap.
  perform pg_advisory_xact_lock(hashtextextended('student_breaks:' || _student_id::text, 0));

  if exists (
    select 1 from public.student_breaks b
    where b.student_id = _student_id and b.cancelled_at is null
      and b.starts_on <= _ends_on and b.ends_on >= _starts_on
  ) then
    raise exception 'That overlaps a break that is already booked.'
      using errcode = '23514', hint = 'break_overlaps';
  end if;

  -- Four weeks at a time: breaks that touch run on as one.
  _run_from := _starts_on;
  _run_to := _ends_on;
  loop
    select b.starts_on into _edge from public.student_breaks b
     where b.student_id = _student_id and b.cancelled_at is null and b.ends_on = _run_from - 1;
    exit when not found;
    _run_from := _edge;
  end loop;
  loop
    select b.ends_on into _edge from public.student_breaks b
     where b.student_id = _student_id and b.cancelled_at is null and b.starts_on = _run_to + 1;
    exit when not found;
    _run_to := _edge;
  end loop;
  if _run_to - _run_from + 1 > 28 then
    raise exception 'A break can be 4 weeks at most, counting any break it runs on from.'
      using errcode = '23514', hint = 'break_too_long';
  end if;

  -- None in the 6 weeks before an exam, or in the exam week. Only exams the
  -- student has a programme for are known.
  select min(pp.exam_date) into _exam
  from public.student_program_plan pp
  where pp.student_id = _student_id
    and _starts_on <= date_trunc('week', pp.exam_date::timestamp)::date + 6
    and _ends_on >= date_trunc('week', pp.exam_date::timestamp)::date - 42;
  if _exam is not null then
    raise exception 'A break can''t be in the 6 weeks before an exam (exam on %).',
      to_char(_exam, 'FMDD Mon YYYY')
      using errcode = '23514', hint = 'break_near_exam';
  end if;

  insert into public.student_breaks (student_id, starts_on, ends_on, reason, booked_by)
  values (_student_id, _starts_on, _ends_on, _reason, _caller)
  returning id into _id;

  select nullif(split_part(btrim(coalesce(p.display_name, '')), ' ', 1), '') into _name
  from public.profiles p where p.id = _student_id;
  _by_tutor := _caller <> _student_id and public.plan_override_caller_is_tutor();
  _when := 'No new work from ' || to_char(_starts_on, 'Dy FMDD Mon') || ' to '
    || to_char(_ends_on, 'Dy FMDD Mon') || '.';

  -- A linked parent is always told, unless they booked it themselves.
  insert into public.notifications (user_id, type, title, body, link)
  select distinct l.parent_id, 'break_booked',
         coalesce(_name, 'Your child') || ' is taking a break',
         _when || case
           when _caller = _student_id then ' ' || coalesce(_name, 'They') || ' booked it.'
           when _by_tutor then ' Their tutor booked it.'
           else ' A parent booked it.'
         end,
         '/parent-dashboard'
  from public.parent_student_links l
  where l.student_id = _student_id and l.parent_id <> _caller;

  -- And the student, when someone else booked it.
  if _caller <> _student_id then
    insert into public.notifications (user_id, type, title, body, link)
    values (
      _student_id, 'break_booked', 'You''re taking a break',
      _when || case when _by_tutor then ' Your tutor booked it.' else ' Your parent booked it.' end,
      '/planner'
    );
  end if;

  return _id;
end;
$function$;

revoke all on function public.book_break(uuid, date, integer, text) from public, anon;
grant execute on function public.book_break(uuid, date, integer, text) to authenticated;

-- Call a break off, or end it early by coming back. Returns 'cancelled' or
-- 'ended_early'.
--
-- A break that hasn't started, or started this week, is called off as if it
-- was never booked. One that started in an earlier week ends on the Sunday
-- before this week, so this week is a working week again. Coming back early
-- also calls off any break that would have run on from it.
create or replace function public.end_break(_break_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _caller uuid := (select auth.uid());
  _this_week date := date_trunc('week', now() at time zone 'Europe/London')::date;
  _b public.student_breaks%rowtype;
  _next date;
begin
  select * into _b from public.student_breaks where id = _break_id for update;
  if not found or _b.cancelled_at is not null then
    raise exception 'That break no longer exists.' using errcode = 'P0002';
  end if;
  if not private.may_manage_breaks(_b.student_id) then
    raise exception 'Only the student, their parent or a tutor can change a break.'
      using errcode = '42501';
  end if;
  if _b.ends_on < _this_week then
    raise exception 'That break is already over.' using errcode = '22023';
  end if;

  if _b.starts_on >= _this_week then
    update public.student_breaks
       set cancelled_at = now(), ended_by = _caller
     where id = _break_id;
    return 'cancelled';
  end if;

  update public.student_breaks
     set ends_on = _this_week - 1, ended_early_at = now(), ended_by = _caller
   where id = _break_id;
  -- Back means back: a break booked to run on from this one goes too.
  _next := _b.ends_on + 1;
  loop
    update public.student_breaks b
       set cancelled_at = now(), ended_by = _caller
     where b.student_id = _b.student_id and b.cancelled_at is null and b.starts_on = _next
    returning b.ends_on + 1 into _next;
    exit when not found;
  end loop;
  return 'ended_early';
end;
$function$;

revoke all on function public.end_break(uuid) from public, anon;
grant execute on function public.end_break(uuid) to authenticated;

-- Nothing is planned in a break week, by any route in: save_weekly_plan, a
-- point added straight to a week, a tutor's pin, or work carried forward.
-- Points already in a week stay, and can still be ticked off.
create or replace function private.refuse_planning_on_a_break()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _student uuid;
  _week date;
begin
  if tg_table_name = 'student_weekly_plans' then
    _student := new.student_id;
    _week := new.week_start;
  else
    select w.student_id, w.week_start into _student, _week
    from public.student_weekly_plans w
    where w.id = new.plan_id;
  end if;

  if exists (
    select 1 from public.student_breaks b
    where b.student_id = _student and b.cancelled_at is null
      and _week between b.starts_on and b.ends_on
  ) then
    raise exception using
      errcode = '23514',
      message = 'This is a break week, so nothing new can be planned for it.',
      hint = 'on_a_break';
  end if;
  return new;
end;
$function$;

revoke all on function private.refuse_planning_on_a_break() from public, anon, authenticated;

create trigger plan_not_on_a_break
  before insert on public.student_weekly_plans
  for each row execute function private.refuse_planning_on_a_break();

create trigger plan_point_not_on_a_break
  before insert or update of plan_id on public.student_weekly_plan_points
  for each row execute function private.refuse_planning_on_a_break();

-- A family's cancellation erases the student's breaks with the rest of their
-- progress (20261004092000). The body below is that migration's, with one
-- line added: the delete from student_breaks.
create or replace function private.erase_cancelled_progress()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _due record;
  _stop public.student_subject_pauses%rowtype;
  _subject public.subject;
  _erased integer := 0;
begin
  for _due in
    select distinct p.student_id
    from public.student_subject_pauses p
    where p.ended_at is null
      and p.reason in ('cancelled', 'subject_removed')
      and p.cancelled_at <= now() - interval '7 days'
  loop
    -- Bring the record up to date first. A family who came back in time, or
    -- re-added the subject, has had their stop closed or its stamp cleared.
    perform private.sync_subject_pauses(_due.student_id);

    for _stop in
      select * from public.student_subject_pauses p
      where p.student_id = _due.student_id
        and p.ended_at is null
        and p.reason in ('cancelled', 'subject_removed')
        and p.cancelled_at <= now() - interval '7 days'
      order by p.cancelled_at
    loop
      -- Erasing a cancelled plan takes every subject's stop with it.
      continue when not exists (select 1 from public.student_subject_pauses p where p.id = _stop.id);
      if _stop.reason = 'cancelled' then
        -- The whole plan was cancelled. Never while it gives access again.
        continue when private.student_has_access(_stop.student_id);
        foreach _subject in array enum_range(null::public.subject) loop
          perform private.erase_subject_progress(_stop.student_id, _subject);
        end loop;
        delete from public.student_tutor_notes where student_id = _stop.student_id;
        delete from public.student_learning_profile where student_id = _stop.student_id;
        delete from public.student_breaks where student_id = _stop.student_id;
      else
        -- One subject removed. Never while it is paid for or back on the list.
        continue when _stop.subject::text = any (private.student_paid_subjects(_stop.student_id))
          or exists (select 1 from public.student_enrolments e
                     where e.student_id = _stop.student_id and e.subject = _stop.subject);
        perform private.erase_subject_progress(_stop.student_id, _stop.subject);
      end if;
      _erased := _erased + 1;
    end loop;
  end loop;
  return _erased;
end;
$function$;

revoke all on function private.erase_cancelled_progress() from public, anon, authenticated;
