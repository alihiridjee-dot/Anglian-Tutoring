-- A student sits every subject at one level, but each subject can be a
-- different exam board. So the shared level lives on the profile and board is
-- captured per subject in its own table.

alter table public.profiles
  add column if not exists level public.level;

comment on column public.profiles.level is
  'The student''s shared exam level (gcse/alevel). Board is per-subject in public.student_enrolments.';

create table if not exists public.student_enrolments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  subject public.subject not null,
  board public.board not null,
  created_at timestamptz not null default now(),
  unique (student_id, subject)
);

comment on table public.student_enrolments is
  'One row per subject a student is enrolled in, each with its own exam board. The shared level lives on profiles.level.';

create index if not exists student_enrolments_student_id_idx
  on public.student_enrolments (student_id);

alter table public.student_enrolments enable row level security;

-- Mirrors the profiles policy set: self-managed, parents read their linked
-- child, tutors read all.
create policy "enrolments self read"
  on public.student_enrolments for select
  using (student_id = auth.uid());

create policy "enrolments self insert"
  on public.student_enrolments for insert
  with check (student_id = auth.uid());

create policy "enrolments self update"
  on public.student_enrolments for update
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

create policy "enrolments self delete"
  on public.student_enrolments for delete
  using (student_id = auth.uid());

create policy "enrolments parent reads linked"
  on public.student_enrolments for select
  using (exists (
    select 1 from public.parent_student_links l
    where l.parent_id = auth.uid() and l.student_id = student_enrolments.student_id
  ));

create policy "enrolments tutor read"
  on public.student_enrolments for select
  using (private.has_role(auth.uid(), 'tutor'::app_role));

-- Backfill existing students: one enrolment row per subject in enrolled_courses
-- on the default board (edexcel), shared level gcse.
insert into public.student_enrolments (student_id, subject, board)
select p.id, subj::public.subject, 'edexcel'::public.board
from public.profiles p
cross join lateral unnest(p.enrolled_courses) as subj
where p.role = 'student'
  and subj in ('biology','chemistry','physics')
on conflict (student_id, subject) do nothing;

update public.profiles
set level = 'gcse'::public.level
where role = 'student' and level is null;

-- Capture per-subject board + shared level at signup. The signup form sends
-- signup_enrolments as [{ "subject": "...", "board": "..." }, ...].
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  meta_role text;
  final_role public.profile_role;
  signup_tier text;
  signup_level text;
  lvl public.level;
  enrolments_json jsonb;
  subj_list text[];
begin
  meta_role := lower(coalesce(NEW.raw_user_meta_data->>'role', 'student'));
  final_role := case
    when meta_role in ('student', 'parent', 'tutor') then meta_role::public.profile_role
    else 'student'::public.profile_role
  end;
  signup_tier  := NEW.raw_user_meta_data->>'signup_tier';
  signup_level := NEW.raw_user_meta_data->>'signup_level';
  -- Only gcse/alevel are real curriculum levels; anything else (e.g. ks3) has
  -- no spec content, so we leave the shared level unset rather than guess.
  lvl := case when signup_level in ('gcse','alevel') then signup_level::public.level else null end;

  insert into public.profiles (id, display_name, role, phone, level)
  values (
    NEW.id,
    coalesce(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    final_role,
    NEW.raw_user_meta_data->>'phone',
    case when final_role = 'student' then lvl else null end
  );

  if lower(NEW.email) = 'asa180@live.co.uk' then
    insert into public.user_roles (user_id, role) values (NEW.id, 'tutor');
    update public.profiles set role = 'tutor' where id = NEW.id;
  elsif final_role = 'tutor' then
    insert into public.user_roles (user_id, role) values (NEW.id, 'tutor');
  else
    insert into public.user_roles (user_id, role) values (NEW.id, 'student');
  end if;

  if final_role = 'student' then
    enrolments_json := NEW.raw_user_meta_data->'signup_enrolments';

    if enrolments_json is not null
       and jsonb_typeof(enrolments_json) = 'array'
       and jsonb_array_length(enrolments_json) > 0 then
      insert into public.student_enrolments (student_id, subject, board)
      select NEW.id,
             (e->>'subject')::public.subject,
             coalesce(nullif(e->>'board','')::public.board, 'edexcel'::public.board)
      from jsonb_array_elements(enrolments_json) e
      where e->>'subject' in ('biology','chemistry','physics')
      on conflict (student_id, subject) do update set board = excluded.board;

    elsif signup_tier is not null or signup_level is not null then
      -- Legacy fallback (no per-subject boards sent): enrol in the tier's
      -- subjects, or all three, on the default board.
      subj_list := coalesce(
        nullif((select subjects from public.packages where tier = signup_tier), '{}'),
        array['biology','chemistry','physics']
      );
      insert into public.student_enrolments (student_id, subject, board)
      select NEW.id, s::public.subject, 'edexcel'::public.board
      from unnest(subj_list) s
      where s in ('biology','chemistry','physics')
      on conflict (student_id, subject) do nothing;
    end if;

    -- Keep enrolled_courses (the subject list many reads still use) in sync.
    update public.profiles
    set enrolled_courses = coalesce(
      (select array_agg(distinct e.subject::text order by e.subject::text)
         from public.student_enrolments e where e.student_id = NEW.id),
      '{}'
    )
    where id = NEW.id;

    if signup_tier is not null or signup_level is not null then
      insert into public.subscriptions (user_id, plan, status)
        values (NEW.id, coalesce(signup_tier, signup_level), 'trialing')
        on conflict (user_id) do update
          set plan = excluded.plan, status = excluded.status, updated_at = now();
    end if;
  end if;

  if final_role = 'parent' and NEW.raw_user_meta_data->>'parent_invite_code' is not null then
    insert into public.parent_student_links (parent_id, student_id)
    select NEW.id, p.id from public.profiles p
    where p.student_invite_code = upper(NEW.raw_user_meta_data->>'parent_invite_code');
  end if;

  return NEW;
end;
$function$;
