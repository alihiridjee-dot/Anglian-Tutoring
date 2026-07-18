-- Spaced-repetition engine (FSRS) for the personalized planner.
-- One FSRS "card" per (student, spec point) in student_spec_point_schedule, and
-- an append-only ledger of review events in student_spec_point_reviews whose
-- (student, point, source, source_id) uniqueness makes replaying a homework/MCQ
-- result idempotent. RLS mirrors the confidence tables: student owns their rows,
-- tutors/admins manage any, parents read their child's.

-- ── Schedule: the current FSRS card per spec point ───────────────────────────
create table if not exists public.student_spec_point_schedule (
  student_id    uuid        not null references auth.users(id) on delete cascade,
  spec_point_id uuid        not null references public.spec_points(id) on delete cascade,
  card          jsonb       not null,
  due           timestamptz not null,
  last_review   timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (student_id, spec_point_id)
);

create index if not exists ssps_student_due_idx
  on public.student_spec_point_schedule (student_id, due);

-- ── Reviews: append-only ledger of graded events ─────────────────────────────
create table if not exists public.student_spec_point_reviews (
  id            uuid        not null default gen_random_uuid() primary key,
  student_id    uuid        not null references auth.users(id) on delete cascade,
  spec_point_id uuid        not null references public.spec_points(id) on delete cascade,
  rating        smallint    not null check (rating >= 1 and rating <= 4),
  source        text        not null,
  score_pct     smallint,
  source_id     text,
  reviewed_at   timestamptz not null default now()
);

-- Idempotency: a homework/MCQ result (stable source_id) applies once; confidence
-- / self-report events carry a null source_id and so always insert (NULLs are
-- distinct in a unique index).
create unique index if not exists sspr_dedupe_idx
  on public.student_spec_point_reviews (student_id, spec_point_id, source, source_id);
create index if not exists sspr_student_point_idx
  on public.student_spec_point_reviews (student_id, spec_point_id, reviewed_at);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.student_spec_point_schedule enable row level security;
alter table public.student_spec_point_reviews  enable row level security;

drop policy if exists "ssps own" on public.student_spec_point_schedule;
create policy "ssps own" on public.student_spec_point_schedule
  for all to authenticated
  using (auth.uid() = student_id)
  with check (auth.uid() = student_id);

drop policy if exists "ssps tutor" on public.student_spec_point_schedule;
create policy "ssps tutor" on public.student_spec_point_schedule
  for all to authenticated
  using (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role))
  with check (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role));

drop policy if exists "ssps parent" on public.student_spec_point_schedule;
create policy "ssps parent" on public.student_spec_point_schedule
  for select to authenticated
  using (exists (
    select 1 from public.parent_student_links l
    where l.parent_id = auth.uid() and l.student_id = student_spec_point_schedule.student_id
  ));

drop policy if exists "sspr own" on public.student_spec_point_reviews;
create policy "sspr own" on public.student_spec_point_reviews
  for all to authenticated
  using (auth.uid() = student_id)
  with check (auth.uid() = student_id);

drop policy if exists "sspr tutor" on public.student_spec_point_reviews;
create policy "sspr tutor" on public.student_spec_point_reviews
  for all to authenticated
  using (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role))
  with check (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role));

drop policy if exists "sspr parent" on public.student_spec_point_reviews;
create policy "sspr parent" on public.student_spec_point_reviews
  for select to authenticated
  using (exists (
    select 1 from public.parent_student_links l
    where l.parent_id = auth.uid() and l.student_id = student_spec_point_reviews.student_id
  ));
