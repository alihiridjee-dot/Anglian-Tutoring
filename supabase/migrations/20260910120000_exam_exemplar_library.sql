-- The library of real exam questions that generation and marking are steered by.
--
-- Two tables rather than one, because a single exam question routinely credits
-- more than one specification point — a six-marker on photosynthesis can cover
-- three. Storing one `spec_point_id` on the question would force a choice that
-- the paper does not make, and would understate coverage exactly where coverage
-- is thinnest: against 2,063 spec points, being able to file one question under
-- three of them is the difference between a usable library and a sparse one.
--
-- Nothing here is student data. It is exam board copyright held for internal
-- reference, so it is readable by tutors only — no student-facing policy exists
-- on either table, deliberately. Serving these verbatim to students is a
-- licensing question to answer before, not after, the RLS is written.

create table public.exam_exemplars (
  id uuid primary key default gen_random_uuid(),

  -- Provenance. Kept as plain columns rather than a foreign key to a papers
  -- table: a paper has no life of its own here, and being able to say
  -- "Edexcel Physics GCSE 2018 paper 1F, question 7(a)(iii)" on a generated
  -- worksheet matters more than normalising it.
  board           text not null,
  subject         text not null,
  level           text not null,
  year            text,
  paper           text,
  tier            text,
  question_label  text not null,

  prompt      text not null,
  marks       integer,
  mark_scheme text,
  -- Multiple-choice options as [{"letter":"A","text":"..."}]. Null for a
  -- written-answer question, which is most of them.
  options     jsonb,

  -- The text layer of a PDF drops figures entirely, so roughly a quarter of
  -- extracted rows reference a diagram that is not in `prompt`. Those are still
  -- worth storing — they are a real question, and the image can be attached
  -- later — but they must never reach a student or an exemplar prompt as they
  -- stand, which is why this is a column and not a comment.
  needs_image boolean not null default false,

  -- What the parser could not verify about this row. Empty means every check
  -- the source paper allowed passed.
  flags text[] not null default '{}',

  -- Nothing is used until a tutor has looked at it. Everything downstream
  -- copies these, so an unreviewed row propagates its mistakes.
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),

  -- Re-running the ingest on the same paper should update rows, not duplicate
  -- them. The label is unique within a paper by construction.
  unique (board, subject, level, year, paper, tier, question_label)
);

comment on table public.exam_exemplars is
  'Real exam questions and their mark schemes, used to steer question generation '
  'and marking. Tutor-only: exam board copyright held for internal reference.';

comment on column public.exam_exemplars.needs_image is
  'The question refers to a figure the PDF text layer does not contain. Not usable '
  'as an exemplar until an image is attached.';

comment on column public.exam_exemplars.flags is
  'Checks the parser could not satisfy for this row. Empty means clean.';

create index exam_exemplars_unapproved
  on public.exam_exemplars (created_at)
  where approved_at is null;

-- Retrieval is always "approved exemplars for this spec point", so the partial
-- index carries the approval condition rather than filtering after the fact.
create index exam_exemplars_approved
  on public.exam_exemplars (subject, level, board)
  where approved_at is not null and needs_image = false;


create table public.exam_exemplar_spec_points (
  exemplar_id   uuid not null references public.exam_exemplars (id) on delete cascade,
  spec_point_id uuid not null references public.spec_points (id) on delete cascade,
  -- Tagging is the judgement half of ingestion and the half most worth
  -- reviewing: a bad split is obvious, a bad tag is invisible.
  created_at    timestamptz not null default now(),
  primary key (exemplar_id, spec_point_id)
);

comment on table public.exam_exemplar_spec_points is
  'Which specification points an exam question credits. Many-to-many: one question '
  'commonly covers several.';

create index exam_exemplar_spec_points_by_point
  on public.exam_exemplar_spec_points (spec_point_id);


alter table public.exam_exemplars enable row level security;
alter table public.exam_exemplar_spec_points enable row level security;

create policy "exemplars tutors read"
  on public.exam_exemplars for select to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::app_role));

create policy "exemplars tutors write"
  on public.exam_exemplars for all to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::app_role))
  with check (private.has_role((select auth.uid()), 'tutor'::app_role));

create policy "exemplar tags tutors read"
  on public.exam_exemplar_spec_points for select to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::app_role));

create policy "exemplar tags tutors write"
  on public.exam_exemplar_spec_points for all to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::app_role))
  with check (private.has_role((select auth.uid()), 'tutor'::app_role));
