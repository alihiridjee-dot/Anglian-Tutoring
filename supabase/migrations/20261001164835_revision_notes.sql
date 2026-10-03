-- Revision notes.
--
-- One note per *concept*: a revision-sized idea shared by every board that
-- teaches it (1,684 GCSE spec points consolidate into 338 concepts, see
-- scripts/notes/concepts). A note's body is the JSON format in
-- src/lib/notes/noteFormat.ts — the shared explanation plus a short layer per
-- board — so the app renders it without joins and a format change needs no
-- migration.
--
-- Notes are loaded by scripts/notes/load-notes.ts with the service role. They
-- are published ('approved') once they pass the automated checks — the format
-- validator and a separate science check — with no person in the loop; a tutor
-- can still edit a note or set it back to draft. Students and their parents
-- only ever see approved notes, and only in the subjects they have paid for —
-- the same gate as MCQ sets and resources (private.my_content_subjects()).

create table public.note_concepts (
  id text primary key,                                   -- e.g. 'bio-012'
  subject public.subject not null,
  level public.level not null default 'gcse',
  chapter text not null,
  title text not null,
  scope text not null,
  kind text not null check (kind in ('content', 'practical', 'skills')),
  higher_only boolean not null default false,
  separate_only boolean not null default false,
  sort_order integer not null,
  created_at timestamptz not null default now()
);

create index note_concepts_subject_level_order on public.note_concepts (subject, level, sort_order);

-- Which spec points a concept's note covers. `is_primary`: each GCSE spec point
-- is primary in exactly one concept; a broad point can also need other notes.
create table public.note_concept_spec_points (
  concept_id text not null references public.note_concepts (id) on delete cascade,
  spec_point_id uuid not null references public.spec_points (id) on delete cascade,
  is_primary boolean not null,
  primary key (concept_id, spec_point_id)
);

create index note_concept_spec_points_spec_point on public.note_concept_spec_points (spec_point_id);

create table public.notes (
  concept_id text primary key references public.note_concepts (id) on delete cascade,
  body jsonb not null,
  format smallint not null default 1,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  written_by text not null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((status = 'approved') = (approved_at is not null))
);

alter table public.note_concepts enable row level security;
alter table public.note_concept_spec_points enable row level security;
alter table public.notes enable row level security;

-- Reading. Tutors see everything, drafts included. Everyone else sees the
-- concepts in their paid subjects, and only the approved notes among them.
create policy "note_concepts read scoped" on public.note_concepts
  for select to authenticated
  using (
    (select private.has_role((select auth.uid()), 'tutor'::public.app_role))
    or subject::text in (select unnest(private.my_content_subjects()))
  );

create policy "note_concept_spec_points read scoped" on public.note_concept_spec_points
  for select to authenticated
  using (
    exists (select 1 from public.note_concepts c where c.id = concept_id)
  );

create policy "notes read scoped" on public.notes
  for select to authenticated
  using (
    (select private.has_role((select auth.uid()), 'tutor'::public.app_role))
    or (
      status = 'approved'
      and exists (
        select 1 from public.note_concepts c
        where c.id = concept_id
          and c.subject::text in (select unnest(private.my_content_subjects()))
      )
    )
  );

-- Writing is for tutors (editing and approving). Drafts are loaded with the
-- service role, which bypasses RLS.
create policy "note_concepts tutors write" on public.note_concepts
  for all to authenticated
  using ((select private.has_role((select auth.uid()), 'tutor'::public.app_role)))
  with check ((select private.has_role((select auth.uid()), 'tutor'::public.app_role)));

create policy "note_concept_spec_points tutors write" on public.note_concept_spec_points
  for all to authenticated
  using ((select private.has_role((select auth.uid()), 'tutor'::public.app_role)))
  with check ((select private.has_role((select auth.uid()), 'tutor'::public.app_role)));

create policy "notes tutors write" on public.notes
  for all to authenticated
  using ((select private.has_role((select auth.uid()), 'tutor'::public.app_role)))
  with check ((select private.has_role((select auth.uid()), 'tutor'::public.app_role)));

revoke all on public.note_concepts, public.note_concept_spec_points, public.notes from anon;
grant select, insert, update, delete on public.note_concepts, public.note_concept_spec_points, public.notes to authenticated;
