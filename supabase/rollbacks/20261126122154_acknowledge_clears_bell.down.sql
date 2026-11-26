-- Undo 20261126122154_acknowledge_clears_bell: Acknowledge no longer clears
-- the "Task marked" notice. The notices that migration deleted are not brought
-- back.

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
      coalesce(hw_title, 'Task'),
      '/homework',
      _submission_id
    );
  end if;
end;
$function$;
