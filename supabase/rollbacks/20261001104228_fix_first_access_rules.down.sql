-- Rollback for 20261001104228_fix_first_access_rules.sql. Restores the live
-- definitions as they stood on 2026-09-28. This reopens every hole the
-- migration closed; only use it if the migration itself breaks something.

-- #10
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
        where (r.file_path = objects.name or r.mark_scheme_path = objects.name)
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
-- Roll back 20261001111025_withhold_homework_mark_schemes.sql first: the app
-- reads schemes through this function once the column is withheld.
drop function if exists public.homework_mark_schemes(uuid[]);

-- #9
alter table public.student_program_plan
  drop constraint if exists student_program_plan_exam_date_plausible;

-- #7
create or replace function private.my_content_subjects()
 returns text[]
 language sql
 stable security definer
 set search_path to 'public', 'private'
as $function$
  select case
    when not private.viewer_has_content_access((select auth.uid())) then '{}'::text[]
    else coalesce(
      (
        select array_agg(distinct s)
        from (
          select unnest(coalesce(p.enrolled_courses, '{}'::text[])) as s
          from public.profiles p
          where p.id = (select auth.uid())
          union
          select unnest(coalesce(cp.enrolled_courses, '{}'::text[])) as s
          from public.parent_student_links l
          join public.profiles cp on cp.id = l.student_id
          where l.parent_id = (select auth.uid())
        ) q
      ),
      '{}'::text[]
    )
  end
$function$;
drop function if exists private.student_paid_subjects(uuid);

-- #3
drop trigger if exists psl_rotate_invite_code on public.parent_student_links;
drop function if exists private.rotate_invite_code_on_unlink();

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

drop policy "chat_threads read own or tutor" on public.chat_threads;
create policy "chat_threads read own or tutor" on public.chat_threads
  for select
  using (
    student_id = (select auth.uid())
    or private.has_role((select auth.uid()), 'tutor'::public.app_role)
  );

-- #2
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

drop policy "chat_threads member creates own" on public.chat_threads;
create policy "chat_threads member creates own" on public.chat_threads
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
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

-- #1 — only safe while no resources row has a null created_by.
alter table public.resources drop constraint resources_created_by_fkey;
alter table public.resources
  add constraint resources_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete cascade;
alter table public.resources alter column created_by set not null;
