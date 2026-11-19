-- A tutor's saved marking draft is kept whole.
--
-- The marking queue now has a "Save draft" button. It calls
-- save_homework_mark_draft, which has been live since 20260921221948 and was
-- never called by the app: the tutor's marks are staged where the marker's
-- proposal lives (homework_ai_marks), so whatever publishes next, their own
-- click or the 24-hour clock, publishes what they last saved. Three things
-- could still undo a saved draft, and this closes them:
--
--   1. Saving rewrote each staged mark as {question_id, marks, feedback} and
--      so dropped the marker's `held` reason. A held paper is the one a tutor
--      is most likely to part-mark and come back to, and on coming back the
--      "Held for you" reasons on the questions they had not reached were gone.
--      The reason now stays with its question.
--   2. mark-homework could still claim a paper the tutor had saved marks on
--      (one the marker never managed to mark, re-opened by the student within
--      the hour) and write the model's marks over the tutor's. A paper a tutor
--      has saved marks on is no longer claimed.
--   3. A marking run already under way would do the same when it finished. A
--      draft is refused while a run holds the claim (ten minutes at most, see
--      20261001123331), with a reason the tutor is shown.
--
-- Both bodies are otherwise the live ones. Same signatures, grants and
-- security. Idempotent.
--
-- Rollback: supabase/rollbacks/20261119224752_mark_draft_kept_whole.down.sql

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
  -- The marker is part-way through this paper and would write over the draft.
  if _sub.ai_marked_at is null
     and _sub.ai_marking_started_at > now() - interval '10 minutes' then
    raise exception 'This paper is being marked right now. Save again in a minute.';
  end if;

  -- Keep only marks for this sheet's own questions, clamped to each maximum —
  -- the same rule the publisher applies, applied on the way in as well. The
  -- marker's reason for holding a question stays with it.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'question_id', q.id,
             'marks', least(greatest(coalesce((m ->> 'marks')::numeric, 0), 0), q.marks),
             'feedback', coalesce(m ->> 'feedback', '')
           )
           || case when was.held is null then '{}'::jsonb
                   else jsonb_build_object('held', was.held) end
         ), '[]'::jsonb)
    into _clean
    from jsonb_array_elements(coalesce(_marks, '[]'::jsonb)) m
    join public.homework_questions q
      on q.id = (m ->> 'question_id')::uuid
     and q.resource_id = _sub.resource_id
    left join lateral (
      select s ->> 'held' as held
        from public.homework_ai_marks am
       cross join lateral jsonb_array_elements(
               case when jsonb_typeof(am.marks) = 'array' then am.marks else '[]'::jsonb end
             ) s
       where am.submission_id = _submission_id
         and s ->> 'question_id' = q.id::text
         and nullif(btrim(coalesce(s ->> 'held', '')), '') is not null
       limit 1
    ) was on true
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

-- True for the one caller that may mark this submission now: it is unmarked,
-- unpublished, no tutor has saved marks on it, and nobody else is marking it
-- (or their claim has gone stale).
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
       and tutor_reviewed_at is null
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
