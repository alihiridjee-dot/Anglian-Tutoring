-- Homework becomes a built-in activity: the brief carries its own questions and
-- students answer them on the site instead of downloading a worksheet and
-- uploading a scan.
--
--   homework_questions  — the questions a tutor sets on a homework `resource`
--                         (usually AI-generated, always tutor-reviewed).
--   homework_answers    — one row per (submission, question), holding the typed
--                         answer plus any images the student attached to it.
--
-- File attachments don't disappear: images are still bytes in the `resources`
-- bucket under the same `submissions/<student>/<homework>/…` prefix, so the
-- existing storage policies, the size-limit trigger and the acknowledge/delete
-- cleanup paths keep working unchanged. What changes is that they hang off a
-- specific question rather than the submission as a whole.

create table if not exists public.homework_questions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  position int not null,
  prompt text not null,
  -- Marks drive the auto-computed score_pct when a tutor marks question by
  -- question, so they're required and bounded rather than free-form.
  marks int not null default 1 check (marks between 1 and 30),
  answer_type text not null default 'short'
    check (answer_type in ('short', 'long', 'numeric')),
  -- An optional figure (diagram, graph, table) shown above the prompt.
  image_path text,
  image_name text,
  -- What a correct answer looks like: shown to the tutor while marking, and to
  -- the student only after their work has been marked.
  mark_scheme text,
  spec_point_id uuid references public.spec_points(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (resource_id, position)
);

create index if not exists homework_questions_resource_idx
  on public.homework_questions (resource_id, position);
create index if not exists homework_questions_spec_point_idx
  on public.homework_questions (spec_point_id);

create table if not exists public.homework_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null
    references public.homework_submissions(id) on delete cascade,
  question_id uuid not null
    references public.homework_questions(id) on delete cascade,
  answer_text text,
  -- [{ "path": "submissions/…", "name": "photo.jpg" }]
  images jsonb not null default '[]'::jsonb,
  awarded_marks numeric,
  feedback text,
  created_at timestamptz not null default now(),
  unique (submission_id, question_id)
);

create index if not exists homework_answers_submission_idx
  on public.homework_answers (submission_id);

alter table public.homework_questions enable row level security;
alter table public.homework_answers enable row level security;

-- Questions are readable by any viewer who can reach the brief itself: the
-- paywall check matches mcq_questions, and enrolment scoping already happens on
-- `resources`. Only tutors write them.
drop policy if exists "hq read via resource" on public.homework_questions;
create policy "hq read via resource" on public.homework_questions
  for select to authenticated
  using (
    private.has_role((select auth.uid()), 'tutor'::app_role)
    or exists (
      select 1 from public.resources r
      where r.id = homework_questions.resource_id
        and private.viewer_has_content_access((select auth.uid()))
    )
  );

drop policy if exists "hq tutors write" on public.homework_questions;
create policy "hq tutors write" on public.homework_questions
  for all to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::app_role))
  with check (private.has_role((select auth.uid()), 'tutor'::app_role));

-- Answers follow their submission exactly — same audience as "hs read scoped":
-- the student who wrote them, any tutor, and a linked parent.
drop policy if exists "ha read via submission" on public.homework_answers;
create policy "ha read via submission" on public.homework_answers
  for select to authenticated
  using (
    exists (
      select 1 from public.homework_submissions s
      where s.id = homework_answers.submission_id
        and (
          s.student_id = (select auth.uid())
          or private.has_role((select auth.uid()), 'tutor'::app_role)
          or exists (
            select 1 from public.parent_student_links l
            where l.parent_id = (select auth.uid())
              and l.student_id = s.student_id
          )
        )
    )
  );

-- Answers are written by submit_homework_answers (definer), so students need no
-- direct INSERT grant here; a tutor may add one while marking legacy work.
drop policy if exists "ha tutor write" on public.homework_answers;
create policy "ha tutor write" on public.homework_answers
  for insert to authenticated
  with check (private.has_role((select auth.uid()), 'tutor'::app_role));

-- Only a tutor awards marks; the answer text stays as the student wrote it.
drop policy if exists "ha tutor mark" on public.homework_answers;
create policy "ha tutor mark" on public.homework_answers
  for update to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::app_role))
  with check (private.has_role((select auth.uid()), 'tutor'::app_role));

/**
 * Hand in a built-in homework: the submission row and every answer land in one
 * transaction, so a half-submitted attempt can never exist.
 *
 * `_answers` is [{ question_id, answer_text, images: [{path, name}] }]. Every
 * question id is checked against this brief, so a forged id writes nothing. The
 * image paths are also folded into homework_submissions.files, which is what the
 * acknowledge-and-delete cleanup and the tutor's bulk download already read —
 * built-in answers therefore need no change to either.
 *
 * Submissions stay final: the UNIQUE (resource_id, student_id) index rejects a
 * second attempt, surfaced here as a friendly error rather than a raw 23505.
 */
create or replace function public.submit_homework_answers(
  _resource_id uuid,
  _answers jsonb,
  _notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _submission_id uuid;
  _files jsonb;
begin
  if _uid is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1 from public.resources r
    where r.id = _resource_id and r.kind = 'homework'
  ) then
    raise exception 'That homework does not exist';
  end if;

  if exists (
    select 1 from public.homework_submissions s
    where s.resource_id = _resource_id and s.student_id = _uid
  ) then
    raise exception 'You have already submitted this homework';
  end if;

  -- Reject anything not belonging to this brief before writing a single row.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a
    where not exists (
      select 1 from public.homework_questions q
      where q.id = (a ->> 'question_id')::uuid
        and q.resource_id = _resource_id
    )
  ) then
    raise exception 'An answer refers to a question that is not on this homework';
  end if;

  -- Every attached image, flattened, so the existing file-cleanup paths see them.
  select coalesce(jsonb_agg(img), '[]'::jsonb)
    into _files
  from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a,
       jsonb_array_elements(coalesce(a -> 'images', '[]'::jsonb)) img;

  insert into public.homework_submissions (resource_id, student_id, files, notes, submitted_at)
  values (_resource_id, _uid, _files, nullif(btrim(coalesce(_notes, '')), ''), now())
  returning id into _submission_id;

  insert into public.homework_answers (submission_id, question_id, answer_text, images)
  select
    _submission_id,
    (a ->> 'question_id')::uuid,
    nullif(btrim(coalesce(a ->> 'answer_text', '')), ''),
    coalesce(a -> 'images', '[]'::jsonb)
  from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a;

  return _submission_id;
end;
$$;

-- Signed-in students only: `anon` keeps the default EXECUTE grant unless it's
-- revoked by name, and a definer function shouldn't sit on the public API.
revoke all on function public.submit_homework_answers(uuid, jsonb, text) from public;
revoke execute on function public.submit_homework_answers(uuid, jsonb, text) from anon;
grant execute on function public.submit_homework_answers(uuid, jsonb, text) to authenticated;
