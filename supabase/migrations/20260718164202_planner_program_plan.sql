-- The year-long curriculum programme ("your programme to the exams"). Stores the
-- last-acknowledged pacing (topic → week bands) per student/subject so the
-- roadmap can re-flow from real progress and surface only the diff for the
-- student to accept — nothing about their programme changes silently.

create table if not exists public.student_program_plan (
  student_id      uuid            not null references auth.users(id) on delete cascade,
  subject         public.subject  not null,
  program_start   date            not null,
  exam_date       date            not null,
  pacing          jsonb           not null,
  acknowledged_at timestamptz     not null default now(),
  updated_at      timestamptz     not null default now(),
  primary key (student_id, subject)
);

alter table public.student_program_plan enable row level security;

drop policy if exists "spp own" on public.student_program_plan;
create policy "spp own" on public.student_program_plan
  for all to authenticated
  using (auth.uid() = student_id)
  with check (auth.uid() = student_id);

drop policy if exists "spp tutor" on public.student_program_plan;
create policy "spp tutor" on public.student_program_plan
  for all to authenticated
  using (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role))
  with check (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role));

drop policy if exists "spp parent" on public.student_program_plan;
create policy "spp parent" on public.student_program_plan
  for select to authenticated
  using (exists (
    select 1 from public.parent_student_links l
    where l.parent_id = auth.uid() and l.student_id = student_program_plan.student_id
  ));
