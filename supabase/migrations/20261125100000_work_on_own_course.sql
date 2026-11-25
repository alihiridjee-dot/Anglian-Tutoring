-- A student files work only on their own course.
--
-- The database scopes what a student reads by subject: in a subject they pay
-- for they can read every board's and every level's quizzes and tasks. The app
-- narrows that to their own course, but a link (a search hit, a bookmark, a
-- shared URL) used to open another course's quiz or task, and the database
-- would mark it, and file it into their plan, as if it were their own. A
-- task handed in that way also started paid AI marking. A student on Edexcel
-- IGCSE Chemistry was offered a Cambridge point's material this way (24 Nov).
--
-- From here a quiz attempt or a task hand-in is refused when the student
-- files it on another course: a level that isn't theirs, or a board other
-- than the one they sit that subject with. A quiz they already have an
-- attempt on is let through, so their own past work never locks. Nothing
-- filed before this is touched: none of the 35 attempts and 24 hand-ins on
-- the live project when this was written breaks the rule.
--
-- Only the student filing their own work is checked (auth.uid() is the
-- student on the row). Scripts and the service role, which file nothing for
-- a student through here, pass as before.
--
-- Additive, and safe in either order with the app.

-- Is (subject, board, level) on this student's course? Unknown parts pass: a
-- profile with no level, a row with no board, a subject they have no
-- enrolment in (which the subject rules already handle). The same rule as
-- private.can_request_practice and the app's onOwnCourse.
create or replace function private.on_my_course(
  _uid uuid,
  _subject text,
  _board text,
  _level text
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce((
    select (_level is null or p.level is null or p.level::text = _level)
       and (
         _board is null
         or _subject is null
         or not exists (
           select 1 from public.student_enrolments e
           where e.student_id = _uid and e.subject::text = _subject
         )
         or exists (
           select 1 from public.student_enrolments e
           where e.student_id = _uid and e.subject::text = _subject and e.board::text = _board
         )
       )
    from public.profiles p
    where p.id = _uid
  ), true);
$function$;

revoke all on function private.on_my_course(uuid, text, text, text) from public;

-- A quiz attempt: the course is the one of the spec point the quiz tests.
create or replace function private.attempt_on_own_course()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  _course record;
begin
  if auth.uid() is null or auth.uid() <> new.user_id then
    return new;
  end if;

  select t.subject::text as subject, t.board::text as board, t.level::text as level
    into _course
  from public.mcq_sets s
  join public.spec_points sp on sp.id = s.spec_point_id
  join public.topics t on t.id = sp.topic_id
  where s.id = new.set_id;

  if not found then
    return new;
  end if;

  if exists (
    select 1 from public.mcq_attempts a
    where a.user_id = new.user_id and a.set_id = new.set_id
  ) then
    return new;
  end if;

  if not private.on_my_course(new.user_id, _course.subject, _course.board, _course.level) then
    raise exception 'This quiz isn''t on your course: it was written for another exam board or level.';
  end if;

  return new;
end;
$function$;

revoke all on function private.attempt_on_own_course() from public;

drop trigger if exists mcq_attempts_on_own_course on public.mcq_attempts;
create trigger mcq_attempts_on_own_course
  before insert on public.mcq_attempts
  for each row execute function private.attempt_on_own_course();

-- A task hand-in: the task carries its own subject, board and level. A task
-- can only be handed in once, so there is no earlier work to let through.
create or replace function private.submission_on_own_course()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  _course record;
begin
  if auth.uid() is null or auth.uid() <> new.student_id then
    return new;
  end if;

  select r.subject::text as subject, r.board::text as board, r.level::text as level
    into _course
  from public.resources r
  where r.id = new.resource_id;

  if not found then
    return new;
  end if;

  if not private.on_my_course(new.student_id, _course.subject, _course.board, _course.level) then
    raise exception 'This task isn''t on your course: it was written for another exam board or level.';
  end if;

  return new;
end;
$function$;

revoke all on function private.submission_on_own_course() from public;

drop trigger if exists homework_submissions_on_own_course on public.homework_submissions;
create trigger homework_submissions_on_own_course
  before insert on public.homework_submissions
  for each row execute function private.submission_on_own_course();
