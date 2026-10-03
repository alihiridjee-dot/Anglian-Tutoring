-- S-26: a tutor can't move a student onto a course with no curriculum.
--
-- The student record's course editor offered every level and board, and
-- neither tutor_set_student_level nor the enrolments update policy looked at
-- what we teach. A student moved to, say, AQA iGCSE ended up with an empty
-- curriculum, no quizzes or homework, and a planner that withheld everything.
-- The editor now offers only what has curriculum; this is the server's half.
--
-- private.has_curriculum says whether a level, board and subject has spec
-- points, the same test curriculum_coverage() and the pickers use (a topic
-- heading alone is still an empty app).
--
--   - tutor_set_student_level refuses a level at which any of the student's
--     enrolments would have no curriculum. Its body is the live definition
--     with that check added.
--   - A trigger on student_enrolments refuses a board change, made by someone
--     other than the student, that leaves the subject with no curriculum at
--     the student's level. The student's own onboarding and the server's
--     writes (no auth.uid()) are left alone: onboarding already offers only
--     covered boards, and it writes level and boards in separate steps, so a
--     half-finished choice mustn't be refused midway.
--
-- Additive and idempotent; safe in either order with the app.

create or replace function private.has_curriculum(
  _level public.level,
  _board public.board,
  _subject public.subject
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.topics t
      join public.spec_points sp on sp.topic_id = t.id
     where t.level = _level
       and t.board = _board
       and t.subject = _subject
  )
$$;

-- Called only from the SECURITY DEFINER functions below.
revoke all on function private.has_curriculum(public.level, public.board, public.subject) from public, anon, authenticated;

create or replace function public.tutor_set_student_level(_student_id uuid, _level public.level)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  _uncovered text;
begin
  if not (
    private.has_role(auth.uid(), 'tutor'::public.app_role)
    or private.has_role(auth.uid(), 'admin'::public.app_role)
  ) then
    raise exception 'Tutor access required' using errcode = '42501';
  end if;

  -- S-26: every subject the student takes must still have a curriculum.
  select string_agg(initcap(e.subject::text) || ' (' || case e.board when 'aqa' then 'AQA' when 'ocr' then 'OCR' when 'oxford_aqa' then 'OxfordAQA' else initcap(e.board::text) end || ')', ', ' order by e.subject)
    into _uncovered
    from public.student_enrolments e
   where e.student_id = _student_id
     and not private.has_curriculum(_level, e.board, e.subject);
  if _uncovered is not null then
    raise exception 'There''s no curriculum at that level for %. Change the board first, or pick another level.', _uncovered
      using errcode = '22023';
  end if;

  update public.profiles
     set level = _level
   where id = _student_id
     and role = 'student'::public.profile_role;

  if not found then
    raise exception 'No student with that id' using errcode = 'P0002';
  end if;
end;
$function$;

create or replace function private.enrolment_board_needs_curriculum()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _level public.level;
begin
  -- The student's own onboarding, and server writes, are not checked.
  if auth.uid() is null or auth.uid() = new.student_id then
    return new;
  end if;

  select p.level into _level from public.profiles p where p.id = new.student_id;
  -- No level yet: nothing to check against.
  if _level is not null and not private.has_curriculum(_level, new.board, new.subject) then
    raise exception 'There''s no % curriculum for % at this student''s level.',
      case new.board when 'aqa' then 'AQA' when 'ocr' then 'OCR' when 'oxford_aqa' then 'OxfordAQA' else initcap(new.board::text) end, initcap(new.subject::text)
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.enrolment_board_needs_curriculum() from public, anon, authenticated;

drop trigger if exists enrolment_board_needs_curriculum on public.student_enrolments;
create trigger enrolment_board_needs_curriculum
  before update of board on public.student_enrolments
  for each row
  when (new.board is distinct from old.board)
  execute function private.enrolment_board_needs_curriculum();
