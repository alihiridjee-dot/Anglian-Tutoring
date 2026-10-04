-- Rollback for 20261003112000_course_change_needs_curriculum.sql. Safe in
-- either order with the app: the editor's own filtering stays, only the
-- server's refusal goes. tutor_set_student_level goes back to its live body
-- from before (20260923081108).
begin;

drop trigger if exists enrolment_board_needs_curriculum on public.student_enrolments;
drop function if exists private.enrolment_board_needs_curriculum();

create or replace function public.tutor_set_student_level(_student_id uuid, _level public.level)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
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
$function$;

drop function if exists private.has_curriculum(public.level, public.board, public.subject);

commit;
