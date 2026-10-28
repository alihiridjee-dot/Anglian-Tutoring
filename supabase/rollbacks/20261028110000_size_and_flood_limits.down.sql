-- Rollback for 20261028110000_size_and_flood_limits.sql. Run by hand.
--
-- Drops the length checks, the chat flood guards and the draft policies,
-- gives the app's role back every chat column on insert, and puts
-- handle_new_user and submit_homework_answers back as they were live on
-- 28 Oct (md5 of prosrc 588cdbda93d4c21afff5601ffe54cbad,
-- 6119c6adaefa5ea77a5dc9f720633172). Rows the chat guards wrote to
-- ai_request_log are pruned within a day.

drop policy if exists "hd open tasks only" on public.homework_drafts;
drop policy if exists "hd open tasks only on update" on public.homework_drafts;

drop trigger if exists chat_thread_flood_guard on public.chat_threads;
drop trigger if exists chat_message_flood_guard on public.chat_messages;
drop function if exists private.chat_thread_flood_guard();
drop function if exists private.chat_message_flood_guard();
drop function if exists private.claim_chat_send(text, integer, interval);

grant insert on table public.chat_threads to anon, authenticated;
grant insert on table public.chat_messages to anon, authenticated;

alter table public.homework_answers drop constraint if exists homework_answers_answer_text_length;
alter table public.homework_submissions drop constraint if exists homework_submissions_notes_length;
alter table public.homework_drafts drop constraint if exists homework_drafts_answers_fit;
alter table public.homework_drafts drop constraint if exists homework_drafts_notes_length;
alter table public.homework_drafts drop constraint if exists homework_drafts_stamps_size;
alter table public.chat_messages drop constraint if exists chat_messages_body_length;
alter table public.chat_threads drop constraint if exists chat_threads_subject_line_length;
alter table public.chat_threads drop constraint if exists chat_threads_context_label_length;
alter table public.profiles drop constraint if exists profiles_display_name_length;
alter table public.profiles drop constraint if exists profiles_phone_length;
alter table public.profiles drop constraint if exists profiles_school_length;
alter table public.student_weekly_checkins drop constraint if exists student_weekly_checkins_reflection_length;
drop function if exists private.homework_draft_answers_fit(jsonb);

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  meta_role text;
  final_role public.profile_role;
  v_code text := upper(btrim(coalesce(NEW.raw_user_meta_data->>'parent_invite_code', '')));
  v_student uuid;
  v_parent_name text;
begin
  meta_role := lower(coalesce(NEW.raw_user_meta_data->>'role', 'student'));

  -- Self-declared identity, and nothing more. 'tutor' is deliberately absent:
  -- an unrecognised value falls back to 'student' rather than being honoured.
  final_role := case
    when meta_role in ('student', 'parent') then meta_role::public.profile_role
    else 'student'::public.profile_role
  end;

  insert into public.profiles (id, display_name, role, phone)
  values (
    NEW.id,
    -- Our form's name first, then the name a Google / Microsoft sign-up brings.
    coalesce(
      nullif(btrim(NEW.raw_user_meta_data->>'display_name'), ''),
      nullif(btrim(NEW.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(NEW.raw_user_meta_data->>'name'), ''),
      split_part(NEW.email, '@', 1)
    ),
    final_role,
    NEW.raw_user_meta_data->>'phone'
  );

  if lower(NEW.email) = 'asa180@live.co.uk' then
    insert into public.user_roles (user_id, role) values (NEW.id, 'tutor')
    on conflict do nothing;
    update public.profiles set role = 'tutor' where id = NEW.id;
  else
    insert into public.user_roles (user_id, role) values (NEW.id, 'student')
    on conflict do nothing;
  end if;

  -- A parent who signs up with their child's invite code is linked by the
  -- rules link_child_by_code uses later on: the code trimmed and upper-cased,
  -- only a student's code counts, a repeat is a no-op, and the child is told,
  -- so an unexpected link is visible rather than silent.
  if final_role = 'parent' and v_code <> '' then
    select p.id into v_student
    from public.profiles p
    where p.student_invite_code = v_code
      and p.role = 'student'::public.profile_role;

    if v_student is not null then
      insert into public.parent_student_links (parent_id, student_id)
      values (NEW.id, v_student)
      on conflict (parent_id, student_id) do nothing;

      select coalesce(nullif(btrim(p.display_name), ''), 'Your parent/guardian')
        into v_parent_name
      from public.profiles p where p.id = NEW.id;

      insert into public.notifications (user_id, type, title, body, link)
      values (
        v_student, 'parent_invite', 'Parent linked to your account',
        v_parent_name || ' linked to your account using your invite code.', '/parents'
      );
    end if;
  end if;

  return NEW;
end;
$function$;

create or replace function public.submit_homework_answers(_resource_id uuid, _answers jsonb, _notes text DEFAULT NULL::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _uid uuid := auth.uid();
  _submission_id uuid;
begin
  if _uid is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1 from public.resources r where r.id = _resource_id and r.kind = 'homework'
  ) then
    raise exception 'That task does not exist';
  end if;

  -- The resources policy's rule, for the caller (see the header).
  if not exists (
    select 1 from public.resources r
    where r.id = _resource_id
      and (
        private.has_role(_uid, 'tutor'::public.app_role)
        or (
          r.subject::text = any (private.student_paid_subjects(_uid))
          and (
            r.review_status = 'approved'
            or (r.review_status = 'to_review' and (r.publish_at is null or r.publish_at <= now()))
          )
        )
      )
  ) then
    raise exception 'That task is not open to you';
  end if;

  if exists (
    select 1 from public.homework_submissions s
    where s.resource_id = _resource_id and s.student_id = _uid
  ) then
    raise exception 'You have already submitted this task';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a
    where not exists (
      select 1 from public.homework_questions q
      where q.id = (a ->> 'question_id')::uuid and q.resource_id = _resource_id
    )
  ) then
    raise exception 'An answer refers to a question that is not on this task';
  end if;

  insert into public.homework_submissions (resource_id, student_id, notes, submitted_at)
  values (_resource_id, _uid, nullif(btrim(coalesce(_notes, '')), ''), now())
  returning id into _submission_id;

  insert into public.homework_answers (submission_id, question_id, answer_text)
  select
    _submission_id,
    (a ->> 'question_id')::uuid,
    nullif(btrim(coalesce(a ->> 'answer_text', '')), '')
  from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a;

  delete from public.homework_drafts
   where student_id = _uid and resource_id = _resource_id;

  return _submission_id;
end;
$function$;
