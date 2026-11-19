-- Rollback for 20261119224752_mark_draft_kept_whole: saving a marking draft
-- drops the marker's `held` reasons again and is allowed during a marking run,
-- and mark-homework may claim a paper a tutor has saved marks on (the
-- 20260921221948 and 20261001123331 bodies, unchanged).
create or replace function public.save_homework_mark_draft(
  _submission_id uuid,
  _marks jsonb,
  _summary text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _sub public.homework_submissions;
  _clean jsonb;
begin
  if not private.has_role((select auth.uid()), 'tutor'::public.app_role)
     and not private.has_role((select auth.uid()), 'admin'::public.app_role) then
    raise exception 'Only tutors or admins may save marks' using errcode = '42501';
  end if;

  select * into _sub
    from public.homework_submissions
   where id = _submission_id
     for update;
  if not found then
    raise exception 'No such submission';
  end if;
  if _sub.graded_at is not null then
    raise exception 'This submission is already published';
  end if;

  -- Keep only marks for this sheet's own questions, clamped to each maximum —
  -- the same rule the publisher applies, applied on the way in as well.
  select coalesce(jsonb_agg(jsonb_build_object(
           'question_id', q.id,
           'marks', least(greatest(coalesce((m ->> 'marks')::numeric, 0), 0), q.marks),
           'feedback', coalesce(m ->> 'feedback', '')
         )), '[]'::jsonb)
    into _clean
    from jsonb_array_elements(coalesce(_marks, '[]'::jsonb)) m
    join public.homework_questions q
      on q.id = (m ->> 'question_id')::uuid
     and q.resource_id = _sub.resource_id
   where nullif(btrim(coalesce(m ->> 'marks', '')), '') is not null;

  insert into public.homework_ai_marks (submission_id, marks, summary)
  values (_submission_id, _clean, nullif(btrim(coalesce(_summary, '')), ''))
  on conflict (submission_id) do update
    set marks = excluded.marks,
        summary = excluded.summary;

  update public.homework_submissions
     set tutor_reviewed_at = now()
   where id = _submission_id;
end;
$$;

revoke all on function public.save_homework_mark_draft(uuid, jsonb, text) from public, anon;
grant execute on function public.save_homework_mark_draft(uuid, jsonb, text)
  to authenticated, service_role;

create or replace function public.claim_homework_marking(_submission_id uuid)
 returns boolean
 language sql
 volatile security definer
 set search_path to ''
as $function$
  with claimed as (
    update public.homework_submissions
       set ai_marking_started_at = now()
     where id = _submission_id
       and graded_at is null
       and ai_marked_at is null
       and (ai_marking_started_at is null or ai_marking_started_at < now() - interval '10 minutes')
    returning 1
  )
  select exists (select 1 from claimed)
$function$;

revoke all on function public.claim_homework_marking(uuid) from public;
revoke all on function public.claim_homework_marking(uuid) from anon;
revoke all on function public.claim_homework_marking(uuid) from authenticated;
grant execute on function public.claim_homework_marking(uuid) to service_role;

notify pgrst, 'reload schema';
