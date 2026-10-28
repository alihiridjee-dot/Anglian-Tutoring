-- Breaks: one unread notice a day, not one per booking.
--
-- book_break (20261005163000, live) wrote a new notice to every linked parent
-- on each booking, and calling a break off before it began wrote nothing. So
-- booking and calling off over and over filled a parent's notifications, and
-- the bell, which shows the latest 20, lost everything else.
--
-- Now a booking made while a notice about the same child from the last day is
-- still unread rewrites that notice instead of adding another. The rewrite
-- lists every break of that child booked since the notice was sent that still
-- stands, so a break called off drops out at the next booking and a real one
-- is never written over. Once read, the next booking is a new notice, as is
-- one a day after the first. The student's own notice, when someone else
-- books, works the same way.
--
-- A notice is matched to its child by the booking that sent it (sent in the
-- same transaction, so its created_at is that break's booked_at), never by
-- its title: two children with one first name share a title. created_at is
-- left as it was, so the day counts from the first notice.
--
-- The body below is 20261005163000's (md5 of the live prosrc checked on
-- 28 Oct 2026), with only the two notice blocks changed.

-- The notice body for a child's breaks booked since _since that still stand,
-- earliest first: "No new work from Mon 9 Nov to Sun 29 Nov and from Mon 28
-- Dec to Sun 3 Jan." Who booked them is said when _by booked every one.
create or replace function private.break_notice_body(
  _student_id uuid,
  _since timestamptz,
  _by uuid,
  _who text
)
 returns text
 language sql
 stable
 set search_path to ''
as $function$
  with b as (
    select 'from ' || to_char(b.starts_on, 'Dy FMDD Mon') || ' to '
             || to_char(b.ends_on, 'Dy FMDD Mon') as span,
           b.booked_by,
           row_number() over (order by b.starts_on desc) as from_last
    from public.student_breaks b
    where b.student_id = _student_id and b.cancelled_at is null and b.booked_at >= _since
  )
  select 'No new work '
    || coalesce(
         string_agg(b.span, ', ' order by b.from_last desc) filter (where b.from_last > 1)
           || ' and ',
         '')
    || max(b.span) filter (where b.from_last = 1) || '.'
    || case
         when bool_and(b.booked_by is not distinct from _by)
           then ' ' || _who || case when count(*) > 1 then ' booked them.' else ' booked it.' end
         else ''
       end
  from b;
$function$;

revoke all on function private.break_notice_body(uuid, timestamptz, uuid, text)
  from public, anon, authenticated;

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
  _title text;
  _who text;
  _told uuid[];
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

  -- A linked parent is always told, unless they booked it themselves. One
  -- unread notice a day for each child: a booking made while one from the
  -- last day is still unread rewrites it with every break booked since that
  -- still stands, rather than adding another. The bell shows the latest 20,
  -- so booking and calling off over and over buried everything else.
  _title := coalesce(_name, 'Your child') || ' is taking a break';
  _who := case
    when _caller = _student_id then coalesce(_name, 'They')
    when _by_tutor then 'Their tutor'
    else 'A parent'
  end;
  with rewritten as (
    update public.notifications n
       set title = _title,
           body = private.break_notice_body(_student_id, n.created_at, _caller, _who)
     where n.type = 'break_booked' and n.read_at is null
       and n.created_at > now() - interval '1 day'
       and n.user_id in (
         select l.parent_id from public.parent_student_links l
         where l.student_id = _student_id and l.parent_id <> _caller
       )
       -- About this child: sent by one of this child's bookings.
       and exists (
         select 1 from public.student_breaks b
         where b.student_id = _student_id and b.booked_at = n.created_at
       )
    returning n.user_id
  )
  select coalesce(array_agg(r.user_id), '{}') into _told from rewritten r;
  insert into public.notifications (user_id, type, title, body, link)
  select distinct l.parent_id, 'break_booked', _title,
    private.break_notice_body(_student_id, now(), _caller, _who), '/parent-dashboard'
  from public.parent_student_links l
  -- A link outlives a deleted parent account (the table has no foreign key),
  -- so only parents who still have one are told.
  join auth.users u on u.id = l.parent_id
  where l.student_id = _student_id and l.parent_id <> _caller
    and l.parent_id <> all (_told);

  -- And the student, when someone else booked it: once a day too.
  if _caller <> _student_id then
    _who := case when _by_tutor then 'Your tutor' else 'Your parent' end;
    with rewritten as (
      update public.notifications n
         set body = private.break_notice_body(_student_id, n.created_at, _caller, _who)
       where n.user_id = _student_id and n.type = 'break_booked' and n.read_at is null
         and n.created_at > now() - interval '1 day'
         and exists (
           select 1 from public.student_breaks b
           where b.student_id = _student_id and b.booked_at = n.created_at
         )
      returning n.user_id
    )
    select coalesce(array_agg(r.user_id), '{}') into _told from rewritten r;
    if cardinality(_told) = 0 then
      insert into public.notifications (user_id, type, title, body, link)
      values (_student_id, 'break_booked', 'You''re taking a break',
        private.break_notice_body(_student_id, now(), _caller, _who), '/planner');
    end if;
  end if;

  return _id;
end;
$function$;
