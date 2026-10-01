-- Fix-first review, database half. Six separate repairs in one migration so
-- they land, and roll back, together. Every body below starts from the live
-- definition (pg_get_functiondef / pg_policies on 2026-09-28), not from an
-- older migration file, because the migration history is not a reliable
-- record of what is deployed.
--
--   #1  Purging a student no longer deletes the shared homework sheets
--       they happened to trigger (and every other student's marks on them).
--   #2  A chat thread can only name a real tutor, and the fan-out only ever
--       notifies a tutor or the thread's own member.
--   #3  A parent who is unlinked loses the chat about that child, stops
--       getting replies, and the child's invite code changes.
--   #7  Content access covers as many subjects as the live plan pays for.
--   #9  An exam date must be a plausible date.
--   #10 Mark schemes are withheld from students until their work is marked.


-- ── #1 Shared sheets outlive the student who triggered them ──────────────
-- ensure_generated_homework stamps created_by with whichever student's week
-- first needed the sheet. With ON DELETE CASCADE, purging that student took
-- the sheet, and every other student's submissions, answers and marks on it.
-- The sheet belongs to nobody in particular; losing its author is fine.
alter table public.resources alter column created_by drop not null;
alter table public.resources drop constraint resources_created_by_fkey;
alter table public.resources
  add constraint resources_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;


-- ── #2 / #3 Chat threads ────────────────────────────────────────────────
-- Opening a thread: unchanged, except tutor_id must be a real tutor. The
-- check goes through tutor_directory() (SECURITY DEFINER) because
-- private.has_role() answers false to a non-tutor asking about anyone else.
drop policy "chat_threads member creates own" on public.chat_threads;
create policy "chat_threads member creates own" on public.chat_threads
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and (tutor_id is null or tutor_id in (select d.id from public.tutor_directory() d))
    and case
      when exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role = 'parent'::public.profile_role
      ) then (
        about_student_id is not null
        and exists (
          select 1 from public.parent_student_links l
          where l.parent_id = (select auth.uid())
            and l.student_id = chat_threads.about_student_id
        )
      )
      else about_student_id is null
    end
  );

-- Updating a thread: a member can no longer repoint it at someone who isn't
-- a tutor either.
drop policy "chat_threads participants update" on public.chat_threads;
create policy "chat_threads participants update" on public.chat_threads
  for update to authenticated
  using (
    student_id = (select auth.uid())
    or private.has_role((select auth.uid()), 'tutor'::public.app_role)
  )
  with check (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    or (
      student_id = (select auth.uid())
      and (tutor_id is null or tutor_id in (select d.id from public.tutor_directory() d))
      and (
        about_student_id is null
        or exists (
          select 1 from public.parent_student_links l
          where l.parent_id = (select auth.uid())
            and l.student_id = chat_threads.about_student_id
        )
      )
    )
  );

-- Reading a thread: a parent's thread about a child is readable only while
-- the link to that child exists. The chat_messages read and send policies
-- look threads up through this table under RLS, so they follow it too: an
-- unlinked parent can neither read nor post. Nothing is deleted, so the
-- history comes back if the parent is linked again.
drop policy "chat_threads read own or tutor" on public.chat_threads;
create policy "chat_threads read own or tutor" on public.chat_threads
  for select
  using (
    private.has_role((select auth.uid()), 'tutor'::public.app_role)
    or (
      student_id = (select auth.uid())
      and (
        about_student_id is null
        or exists (
          select 1 from public.parent_student_links l
          where l.parent_id = (select auth.uid())
            and l.student_id = chat_threads.about_student_id
        )
      )
    )
  );

-- The fan-out: as live, plus two refusals before anything reaches a bell.
-- A member's message only notifies a real tutor, and a tutor's reply on a
-- parent thread only notifies a parent who is still linked to the child.
create or replace function public.on_chat_message_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_thread public.chat_threads%rowtype;
  v_from_student boolean;
  v_parent_thread boolean;
  v_recipient uuid;
  v_sender_name text;
begin
  select * into v_thread from public.chat_threads where id = new.thread_id;
  if not found then return new; end if;

  v_from_student := (new.sender_id = v_thread.student_id);
  v_parent_thread := (v_thread.about_student_id is not null);
  v_recipient := case when v_from_student then v_thread.tutor_id else v_thread.student_id end;

  -- Bump the thread, and mark the sender's own side read: you have by
  -- definition seen the message you just sent.
  update public.chat_threads
     set last_message_at = new.created_at,
         status = case when v_from_student then 'open' else 'answered' end,
         student_last_read_at =
           case when v_from_student then new.created_at else student_last_read_at end,
         tutor_last_read_at =
           case when v_from_student then tutor_last_read_at else new.created_at end
   where id = new.thread_id;

  if v_recipient is null or v_recipient = new.sender_id then
    return new;
  end if;

  -- A thread's "tutor" is whatever id its member wrote there. Only notify it
  -- if it really is a tutor, or anyone could post into anyone's bell.
  if v_from_student and not exists (
    select 1 from public.user_roles r
    where r.user_id = v_recipient and r.role = 'tutor'::public.app_role
  ) then
    return new;
  end if;

  -- A parent who has been unlinked from the child no longer hears about them.
  if v_parent_thread and not v_from_student and not exists (
    select 1 from public.parent_student_links l
    where l.parent_id = v_thread.student_id and l.student_id = v_thread.about_student_id
  ) then
    return new;
  end if;

  select coalesce(nullif(btrim(p.display_name), ''),
           case
             when not v_from_student then 'Your tutor'
             when v_parent_thread then 'A parent'
             else 'Your student'
           end)
    into v_sender_name
    from public.profiles p where p.id = new.sender_id;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_recipient,
    'chat_message',
    case
      when not v_from_student then 'Reply from ' || v_sender_name
      when v_parent_thread then v_sender_name || ' sent you a message'
      else v_sender_name || ' sent you a question'
    end,
    left(new.body, 140),
    case when v_parent_thread and not v_from_student then '/parent-dashboard' else '/messages' end
  );

  return new;
end;
$function$;

-- A removed parent already knows the child's invite code, so without this
-- they could re-link the moment they were removed. Rotating on every unlink
-- covers unlink_parent() and a tutor's direct delete alike. Parents still
-- linked stay linked; only the code for future sign-ups changes.
create or replace function private.rotate_invite_code_on_unlink()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  update public.profiles
     set student_invite_code = public.gen_student_invite_code()
   where id = old.student_id;
  return null;
end;
$function$;

revoke all on function private.rotate_invite_code_on_unlink() from public;

create trigger psl_rotate_invite_code
  after delete on public.parent_student_links
  for each row execute function private.rotate_invite_code_on_unlink();


-- ── #7 Content covers the subjects that are paid for ────────────────────
-- The subjects one student's live plan unlocks: their enrolled subjects, in
-- enrolment order, cut to the number the plan pays for ("monthly_2" → 2).
-- A plan name with no count keeps every subject, so an unexpected tier name
-- can't lock a paying family out.
--
-- This closes every route to "pay for one, read three" in one place:
-- enrolling while paused or before paying, and deleting student_enrolments
-- rows so Checkout prices fewer subjects than profiles.enrolled_courses holds.
create or replace function private.student_paid_subjects(p_student_id uuid)
 returns text[]
 language sql
 stable security definer
 set search_path to 'public', 'private'
as $function$
  select coalesce(
    (
      select case
        when x.cap is null then x.courses
        else x.courses[1:x.cap]
      end
      from (
        select
          coalesce(p.enrolled_courses, '{}'::text[]) as courses,
          (
            select max(
              case
                when split_part(s.plan, '_', 2) ~ '^[0-9]+$' then split_part(s.plan, '_', 2)::int
                else null
              end
            )
            from public.subscriptions s
            where s.student_id = p_student_id
              and s.status in ('active', 'trialing')
              and (s.current_period_end is null or s.current_period_end > now())
          ) as cap
        from public.profiles p
        where p.id = p_student_id
          and private.student_has_access(p_student_id)
      ) x
    ),
    '{}'::text[]
  )
$function$;

revoke all on function private.student_paid_subjects(uuid) from public;

-- The viewer's readable subjects: their own paid subjects, plus each linked
-- child's. A parent now gets only the children whose own plan is live —
-- before, one child's plan unlocked every linked child's subjects.
create or replace function private.my_content_subjects()
 returns text[]
 language sql
 stable security definer
 set search_path to 'public', 'private'
as $function$
  select case
    when (select auth.uid()) is null then '{}'::text[]
    else coalesce(
      (
        select array_agg(distinct s)
        from (
          select unnest(private.student_paid_subjects((select auth.uid()))) as s
          union
          select unnest(private.student_paid_subjects(l.student_id)) as s
          from public.parent_student_links l
          where l.parent_id = (select auth.uid())
        ) q
      ),
      '{}'::text[]
    )
  end
$function$;


-- ── #9 A plausible exam date ────────────────────────────────────────────
-- The date box used to save "0002-06-01" after the first digit of the year.
-- The app now refuses that too; this stops it at the source.
alter table public.student_program_plan
  add constraint student_program_plan_exam_date_plausible
  check (exam_date between date '2020-01-01' and date '2040-12-31');


-- ── #10 Mark schemes after marking ──────────────────────────────────────
-- Students read their questions with the mark scheme in the same row, and
-- the page merely hid it until marking — the answer was in the network
-- response. Same approach as mcq_questions.correct_index: withdraw the
-- column from browser reads and hand it out through a function that checks.
--
-- This migration only adds the function. Withdrawing the column is the
-- separate 20261001111025_withhold_homework_mark_schemes.sql, applied once
-- the app that reads through this function is live: the app before it still
-- selects the column, and would break in between.

-- Mark schemes for the given homework, for a tutor, or for a student (or
-- their linked parent) whose submission for that homework has been marked.
-- Marking itself reads with the service role, so it is unaffected.
create or replace function public.homework_mark_schemes(_resource_ids uuid[])
 returns table(question_id uuid, mark_scheme text)
 language sql
 stable security definer
 set search_path to 'public', 'private'
as $function$
  select q.id, q.mark_scheme
  from public.homework_questions q
  where q.resource_id = any (_resource_ids)
    and q.mark_scheme is not null
    and (
      private.has_role((select auth.uid()), 'tutor'::public.app_role)
      or exists (
        select 1 from public.homework_submissions s
        where s.resource_id = q.resource_id
          and s.graded_at is not null
          and (
            s.student_id = (select auth.uid())
            or exists (
              select 1 from public.parent_student_links l
              where l.parent_id = (select auth.uid()) and l.student_id = s.student_id
            )
          )
      )
    )
$function$;

revoke all on function public.homework_mark_schemes(uuid[]) from public;
revoke all on function public.homework_mark_schemes(uuid[]) from anon;
grant execute on function public.homework_mark_schemes(uuid[]) to authenticated;

-- A mark-scheme PDF was downloadable by anyone who could read the homework.
-- None has been uploaded yet; this closes it before one is. Tutors keep
-- access through the has_role branch. Otherwise unchanged from live.
drop policy "resources bucket read scoped" on storage.objects;
create policy "resources bucket read scoped" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'resources'::text
    and (
      private.has_role(auth.uid(), 'tutor'::public.app_role)
      or (
        name ~~ 'submissions/%'::text
        and (
          name ~~ (('submissions/'::text || (auth.uid())::text) || '/%'::text)
          or exists (
            select 1 from public.parent_student_links l
            where l.parent_id = auth.uid()
              and objects.name ~~ (('submissions/'::text || (l.student_id)::text) || '/%'::text)
          )
        )
      )
      or exists (
        select 1 from public.resources r
        where r.file_path = objects.name
          and (
            public.is_enrolled_in(auth.uid(), r.subject)
            or exists (
              select 1
              from public.parent_student_links l
              join public.profiles p on p.id = l.student_id
              where l.parent_id = auth.uid()
                and p.enrolled_courses @> array[(r.subject)::text]
            )
          )
      )
    )
  );
