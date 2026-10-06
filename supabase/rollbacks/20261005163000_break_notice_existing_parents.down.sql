-- Rollback for 20261005163000_break_notice_existing_parents.sql. Run by hand.
--
-- Puts book_break back as 20261005160000 left it, which refuses any booking
-- for a student with a link to a deleted parent account.

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
