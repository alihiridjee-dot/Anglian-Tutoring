-- Personalized study planner (the site's USP). Per-student, RLS-scoped.
--
-- A student rates confidence on topic groups (drag-to-bucket) and, expanded,
-- individual spec points (slider). From that + homework/MCQ performance the
-- platform suggests a weekly plan, editable anytime. A plan is a set of spec
-- points, so the right homework/quizzes surface via the existing
-- resource_spec_points / mcq_sets.spec_point_id links. Kept separate from the
-- tutor-wide `weekly_focus` ("tough topics") feature.
--
-- Confidence is one 0-100 scale everywhere; the UI derives bands from it.
-- Weekly plans are keyed by the Monday that starts the week (matches week.ts).

-- ── Enums ────────────────────────────────────────────────────────────────
do $$ begin
  create type public.plan_source as enum ('ai','student','tutor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.plan_point_origin as enum ('ai','student','tutor','carried_over');
exception when duplicate_object then null; end $$;

-- ── 1 · Topic-group confidence (drives the most↔least sort / buckets) ────
create table if not exists public.student_topic_confidence (
  student_id uuid     not null references auth.users(id) on delete cascade,
  topic_id   uuid     not null references public.topics(id) on delete cascade,
  confidence smallint not null default 50 check (confidence between 0 and 100),
  sort_index integer  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (student_id, topic_id)
);
create index if not exists idx_stc_topic on public.student_topic_confidence(topic_id);

-- ── 2 · Spec-point confidence (the expanded sliders) ─────────────────────
create table if not exists public.student_spec_point_confidence (
  student_id    uuid     not null references auth.users(id) on delete cascade,
  spec_point_id uuid     not null references public.spec_points(id) on delete cascade,
  confidence    smallint not null default 50 check (confidence between 0 and 100),
  updated_at    timestamptz not null default now(),
  primary key (student_id, spec_point_id)
);
create index if not exists idx_sspc_point on public.student_spec_point_confidence(spec_point_id);

-- ── 3 · Term container ───────────────────────────────────────────────────
create table if not exists public.student_term_plans (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  subject    public.subject not null,
  board      public.board   not null,
  level      public.level   not null,
  label      text,
  starts_on  date not null,
  ends_on    date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_term_plans_student on public.student_term_plans(student_id, subject);

-- ── 4 · Weekly plan (per student / subject / week) ───────────────────────
create table if not exists public.student_weekly_plans (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references auth.users(id) on delete cascade,
  term_plan_id uuid references public.student_term_plans(id) on delete set null,
  subject      public.subject not null,
  board        public.board   not null,
  level        public.level   not null,
  week_start   date not null,
  source       public.plan_source not null default 'ai',
  note         text,
  ai_rationale text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (student_id, subject, week_start)
);
create index if not exists idx_weekly_plans_student_week on public.student_weekly_plans(student_id, week_start);

-- ── 5 · Spec points inside a weekly plan ─────────────────────────────────
create table if not exists public.student_weekly_plan_points (
  plan_id       uuid not null references public.student_weekly_plans(id) on delete cascade,
  spec_point_id uuid not null references public.spec_points(id) on delete cascade,
  origin        public.plan_point_origin not null default 'student',
  created_at    timestamptz not null default now(),
  primary key (plan_id, spec_point_id)
);
create index if not exists idx_weekly_plan_points_point on public.student_weekly_plan_points(spec_point_id);

-- ── 6 · End-of-week check-in ─────────────────────────────────────────────
create table if not exists public.student_weekly_checkins (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.student_weekly_plans(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  covered_ok boolean,
  reflection text,
  coverage   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (plan_id)
);
create index if not exists idx_weekly_checkins_student on public.student_weekly_checkins(student_id);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Every table: the student owns their rows (full CRUD); tutors/admins read;
-- a linked parent reads (a parent_student_links row IS the grant). Join tables
-- resolve student ownership through their parent plan.

alter table public.student_topic_confidence      enable row level security;
alter table public.student_spec_point_confidence enable row level security;
alter table public.student_term_plans            enable row level security;
alter table public.student_weekly_plans          enable row level security;
alter table public.student_weekly_plan_points    enable row level security;
alter table public.student_weekly_checkins       enable row level security;

-- Helper predicates repeated inline (Postgres RLS has no shared macro):
--   tutor/admin:  private.has_role(auth.uid(),'tutor') or private.has_role(auth.uid(),'admin')
--   parent-linked: exists parent_student_links l where l.parent_id=auth.uid() and l.student_id=<row student>

-- 1 · student_topic_confidence
create policy "stc own"    on public.student_topic_confidence for all to authenticated
  using (auth.uid() = student_id) with check (auth.uid() = student_id);
create policy "stc tutor"  on public.student_topic_confidence for select to authenticated
  using (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role));
create policy "stc parent" on public.student_topic_confidence for select to authenticated
  using (exists (select 1 from public.parent_student_links l
                 where l.parent_id = auth.uid() and l.student_id = student_topic_confidence.student_id));

-- 2 · student_spec_point_confidence
create policy "sspc own"    on public.student_spec_point_confidence for all to authenticated
  using (auth.uid() = student_id) with check (auth.uid() = student_id);
create policy "sspc tutor"  on public.student_spec_point_confidence for select to authenticated
  using (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role));
create policy "sspc parent" on public.student_spec_point_confidence for select to authenticated
  using (exists (select 1 from public.parent_student_links l
                 where l.parent_id = auth.uid() and l.student_id = student_spec_point_confidence.student_id));

-- 3 · student_term_plans
create policy "term own"    on public.student_term_plans for all to authenticated
  using (auth.uid() = student_id) with check (auth.uid() = student_id);
create policy "term tutor"  on public.student_term_plans for select to authenticated
  using (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role));
create policy "term parent" on public.student_term_plans for select to authenticated
  using (exists (select 1 from public.parent_student_links l
                 where l.parent_id = auth.uid() and l.student_id = student_term_plans.student_id));

-- 4 · student_weekly_plans
create policy "wp own"    on public.student_weekly_plans for all to authenticated
  using (auth.uid() = student_id) with check (auth.uid() = student_id);
create policy "wp tutor"  on public.student_weekly_plans for select to authenticated
  using (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role));
create policy "wp parent" on public.student_weekly_plans for select to authenticated
  using (exists (select 1 from public.parent_student_links l
                 where l.parent_id = auth.uid() and l.student_id = student_weekly_plans.student_id));

-- 5 · student_weekly_plan_points (ownership via parent plan)
create policy "wpp own"    on public.student_weekly_plan_points for all to authenticated
  using (exists (select 1 from public.student_weekly_plans p
                 where p.id = student_weekly_plan_points.plan_id and p.student_id = auth.uid()))
  with check (exists (select 1 from public.student_weekly_plans p
                 where p.id = student_weekly_plan_points.plan_id and p.student_id = auth.uid()));
create policy "wpp tutor"  on public.student_weekly_plan_points for select to authenticated
  using (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role));
create policy "wpp parent" on public.student_weekly_plan_points for select to authenticated
  using (exists (select 1 from public.student_weekly_plans p
                 join public.parent_student_links l on l.student_id = p.student_id
                 where p.id = student_weekly_plan_points.plan_id and l.parent_id = auth.uid()));

-- 6 · student_weekly_checkins
create policy "wc own"    on public.student_weekly_checkins for all to authenticated
  using (auth.uid() = student_id) with check (auth.uid() = student_id);
create policy "wc tutor"  on public.student_weekly_checkins for select to authenticated
  using (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role));
create policy "wc parent" on public.student_weekly_checkins for select to authenticated
  using (exists (select 1 from public.parent_student_links l
                 where l.parent_id = auth.uid() and l.student_id = student_weekly_checkins.student_id));
