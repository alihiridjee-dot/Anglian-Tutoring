-- Acknowledging a marked task clears its notice off the student's bell.
--
-- When a tutor's marks are published, the student gets a "Task marked" notice
-- (type homework_marked, carrying the submission). Pressing Acknowledge on the
-- task now deletes that notice: the student has read the mark, so the bell has
-- nothing left to say about it. Only the student's own homework_marked notices
-- for that one submission go. The tutor's "read your feedback" notice is still
-- sent, and every other notice is left alone.
--
-- Notices for tasks acknowledged before this migration are cleared too.
--
-- Idempotent. Rollback: supabase/rollbacks/20261126122154_acknowledge_clears_bell.down.sql

begin;

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

  -- The mark has been read, so its "Task marked" notice leaves the bell.
  delete from public.notifications
   where user_id = s.student_id
     and submission_id = _submission_id
     and type = 'homework_marked';

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

-- Tasks already acknowledged: their notices go now.
delete from public.notifications n
 using public.homework_submissions s
 where n.submission_id = s.id
   and n.user_id = s.student_id
   and n.type = 'homework_marked'
   and s.acknowledged_at is not null;

commit;
