-- Context for generation stays in Postgres; the server sends selected records
-- to Claude. Original paper rows remain tutor-only, including on student calls.
alter table public.topics
  add column specification_version text,
  add column exam_tier text;
alter table public.spec_points add column assessment_context text;
comment on column public.spec_points.assessment_context is
  'Applicable mathematical/practical skills and scope notes from the specification. Not inferred quotas.';

alter table public.exam_exemplars
  add column specification_version text,
  add column shared_context text,
  add column source_reference jsonb not null default '{}',
  add column command_word text,
  add column assessment_objectives text[] not null default '{}',
  add column question_format text,
  add column mathematical_demand boolean,
  add column practical_demand boolean;
comment on column public.exam_exemplars.source_reference is
  'Source file identifiers, question/mark-scheme pages and extraction version. Preserve the raw source separately.';
comment on column public.exam_exemplars.shared_context is
  'Complete shared introduction and textual data needed by this part. Approval requires its corresponding complete mark scheme.';

create table public.exam_generation_guidance (
  id uuid primary key default gen_random_uuid(),
  board text not null,
  level text not null,
  subject text,
  specification_version text,
  instructions text not null check (length(btrim(instructions)) > 0),
  source_url text not null,
  created_at timestamptz not null default now()
);
alter table public.exam_generation_guidance enable row level security;
grant select, insert, update, delete on public.exam_generation_guidance to authenticated;
grant all on public.exam_generation_guidance to service_role;
create policy "generation guidance tutors" on public.exam_generation_guidance
  for all to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::public.app_role))
  with check (private.has_role((select auth.uid()), 'tutor'::public.app_role));

-- Concise paraphrases, deliberately scoped to the qualification of the sources.
insert into public.exam_generation_guidance (board, level, instructions, source_url) values
('aqa', 'gcse',
 'Match the expected response to the command word: describe requests an account of features or events; explain requires reasons; evaluate requires a supported judgement. Construct the mark scheme with the question. Preserve applicable accept/allow, ignore and do-not-accept distinctions from source schemes.',
 'https://www.aqa.org.uk/resources/science/gcse/teach/command-words'),
('edexcel', 'gcse',
 'Award positive credit for demonstrated knowledge. Preserve acceptable alternative wording and use Additional Guidance alongside the answer. Where applicable, state error-carried-forward rules explicitly. Indicative content is not automatically an exhaustive list of acceptable responses.',
 'https://qualifications.pearson.com/content/dam/pdf/GCSE/Science/2016/Specification/SAMs_GCSE_L1-L2_in_Combined_Science.pdf');

-- A record of what each one-call generation actually used, never returned to students.
create table public.exam_generation_runs (
  id uuid primary key default gen_random_uuid(),
  spec_point_id uuid references public.spec_points(id) on delete set null,
  framework_version text not null,
  model text not null,
  format text not null check (format in ('written', 'mcq')),
  grounding text not null,
  exemplar_ids uuid[] not null,
  generated_questions jsonb not null,
  usage jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.exam_generation_runs enable row level security;
grant all on public.exam_generation_runs to service_role;
grant select on public.exam_generation_runs to authenticated;
create policy "generation runs tutors read" on public.exam_generation_runs
  for select to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::public.app_role));

-- Re-ingestion must not leave an approval attached to different question text.
create function private.invalidate_changed_exemplar_approval()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - array['approved_at', 'approved_by']) is distinct from
     (to_jsonb(old) - array['approved_at', 'approved_by']) then
    new.approved_at := null;
    new.approved_by := null;
  end if;
  return new;
end;
$$;
create trigger invalidate_changed_exemplar_approval before update on public.exam_exemplars
  for each row execute function private.invalidate_changed_exemplar_approval();

-- This RPC is only callable with the server credential. The server first loads
-- the requested spec point through the caller's RLS-scoped client.
create function public.exam_generation_context(_spec_point_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with target as (
    select sp.id, sp.code, sp.title, sp.description, sp.topic_id,
      sp.assessment_context, t.title as topic_title,
      t.board::text as board, t.level::text as level, t.subject::text as subject,
      t.specification_version, t.exam_tier as tier
    from public.spec_points sp join public.topics t on t.id = sp.topic_id
    where sp.id = _spec_point_id
  ), eligible as (
    select e.*, case
      when exists (select 1 from public.exam_exemplar_spec_points l
        where l.exemplar_id = e.id and l.spec_point_id = p.id) then 'exact'
      when exists (select 1 from public.exam_exemplar_spec_points l
        join public.spec_points sp on sp.id = l.spec_point_id
        where l.exemplar_id = e.id and sp.topic_id = p.topic_id) then 'topic'
      else 'style' end as grounding
    from public.exam_exemplars e cross join target p
    where e.board = p.board and e.level = p.level and e.subject = p.subject
      and (p.specification_version is null or e.specification_version is null
        or e.specification_version = p.specification_version)
      and (p.tier is null or e.tier is null or e.tier = p.tier)
      and e.approved_at is not null and not e.needs_image and cardinality(e.flags) = 0
      and length(btrim(e.prompt)) > 0 and length(btrim(e.mark_scheme)) > 0 and e.marks > 0
  ), varied as (
    select e.*, row_number() over (partition by grounding, command_word,
      question_format, mathematical_demand, practical_demand order by id) as variant_rank
    from eligible e
  ), ranked as (
    select e.*, row_number() over (partition by grounding order by variant_rank, id) as pool_rank
    from varied e
  )
  select jsonb_build_object(
    'point', to_jsonb(p),
    'examples', coalesce((select jsonb_agg(to_jsonb(e) - array['variant_rank', 'pool_rank'])
      from ranked e where pool_rank <= 20), '[]'::jsonb),
    'guidance', coalesce((select jsonb_agg(jsonb_build_object(
      'instructions', g.instructions, 'source_url', g.source_url))
      from public.exam_generation_guidance g
      where g.board = p.board and g.level = p.level
        and (g.subject is null or g.subject = p.subject)
        and (g.specification_version is null or g.specification_version = p.specification_version)), '[]'::jsonb)
  ) from target p;
$$;
revoke all on function public.exam_generation_context(uuid) from public, anon, authenticated;
grant execute on function public.exam_generation_context(uuid) to service_role;
grant select on public.exam_exemplars, public.exam_exemplar_spec_points to service_role;
