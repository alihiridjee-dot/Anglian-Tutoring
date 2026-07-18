-- "Ali's take": the tutor's end-of-week note on a student's weekly plan plus the
-- spec points they line up for next week. Kept separate from the student's own
-- check-in so the tutor can't clobber the student's reflection. Tutors write;
-- the student and their parent can read their own note back.

create table if not exists public.student_weekly_tutor_notes (
  plan_id     uuid        not null references public.student_weekly_plans(id) on delete cascade primary key,
  student_id  uuid        not null references auth.users(id) on delete cascade,
  author_id   uuid        not null references auth.users(id),
  note        text,
  next_points uuid[]      not null default '{}'::uuid[],
  updated_at  timestamptz not null default now()
);

create index if not exists swtn_student_idx
  on public.student_weekly_tutor_notes (student_id);

alter table public.student_weekly_tutor_notes enable row level security;

drop policy if exists "swtn tutor" on public.student_weekly_tutor_notes;
create policy "swtn tutor" on public.student_weekly_tutor_notes
  for all to authenticated
  using (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role))
  with check (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role));

drop policy if exists "swtn student" on public.student_weekly_tutor_notes;
create policy "swtn student" on public.student_weekly_tutor_notes
  for select to authenticated
  using (auth.uid() = student_id);

drop policy if exists "swtn parent" on public.student_weekly_tutor_notes;
create policy "swtn parent" on public.student_weekly_tutor_notes
  for select to authenticated
  using (exists (
    select 1 from public.parent_student_links l
    where l.parent_id = auth.uid() and l.student_id = student_weekly_tutor_notes.student_id
  ));
