-- Curriculum RLS: evaluate the access predicates ONCE per query, not once per row.
--
-- The content policies gated every row behind `private.viewer_has_content_access()`
-- and `public.is_enrolled_in()`. Both are STABLE, which means Postgres re-runs them
-- for every candidate row — and each call opens its own subqueries over profiles,
-- user_roles and parent_student_links. Reading spec_points for one student measured
-- 711 ms / 12 000 shared buffers, as a sequential scan, on an idle database. Fifty
-- students opening the curriculum at the same time is fifty of those, which is more
-- CPU than the instance has.
--
-- The fix is the standard one: wrap a whole-query-constant predicate in a scalar
-- subselect so the planner hoists it into an InitPlan. That only works when the
-- expression doesn't reference the row, so the two row-dependent tests are
-- restated as membership in a precomputed set:
--
--   private.my_content_subjects()  -> the subjects the caller may see content for
--   private.my_content_topic_ids() -> the topic ids those subjects cover
--
-- Both are SECURITY DEFINER, so the topic lookup inside the second one does NOT
-- re-enter topics' own RLS. That nested re-entry is what made spec_points expensive:
-- the old plan re-ran the entire topics policy once per spec point (loops=92).
--
-- The visible set is unchanged. Written out, the old predicate for a non-tutor was
-- `has_access AND subject ∈ (own enrolments ∪ linked children's enrolments)`, and
-- that is exactly what my_content_subjects() returns (empty when access is off).

-- The subjects this caller may read curriculum content for.
-- Empty when the caller has no live content access, which collapses every content
-- policy to "no rows" the same way the old `viewer_has_content_access AND …` did.
create or replace function private.my_content_subjects()
returns text[]
language sql
stable
security definer
set search_path = public, private
as $$
  select case
    when not private.viewer_has_content_access((select auth.uid())) then '{}'::text[]
    else coalesce(
      (
        select array_agg(distinct s)
        from (
          -- the caller's own enrolments
          select unnest(coalesce(p.enrolled_courses, '{}'::text[])) as s
          from public.profiles p
          where p.id = (select auth.uid())
          union
          -- plus every linked child's, for the parent view
          select unnest(coalesce(cp.enrolled_courses, '{}'::text[])) as s
          from public.parent_student_links l
          join public.profiles cp on cp.id = l.student_id
          where l.parent_id = (select auth.uid())
        ) q
      ),
      '{}'::text[]
    )
  end
$$;

-- The topic ids under those subjects. SECURITY DEFINER on purpose: reading topics
-- here must not re-run the topics policy, which is what the old spec_points
-- predicate did once per row.
--
-- MATERIALIZED is load-bearing. my_content_subjects() is STABLE, so referencing
-- it directly in the WHERE clause makes Postgres re-run it per topic row — the
-- exact per-row evaluation this migration exists to remove, just moved inside the
-- helper. Measured: 77 ms of the query spent here without it, 1.4 ms with it.
create or replace function private.my_content_topic_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, private
as $$
  with subs as materialized (
    select private.my_content_subjects() as list
  )
  select coalesce(array_agg(t.id), '{}'::uuid[])
  from public.topics t, subs
  where t.subject::text = any (subs.list)
$$;

revoke all on function private.my_content_subjects() from public;
revoke all on function private.my_content_topic_ids() from public;
grant execute on function private.my_content_subjects() to authenticated;
grant execute on function private.my_content_topic_ids() to authenticated;

-- topics --------------------------------------------------------------------
drop policy if exists "topics read scoped" on public.topics;
create policy "topics read scoped" on public.topics
for select to authenticated
using (
  (select private.has_role((select auth.uid()), 'tutor'::app_role))
  -- IN (uncorrelated subquery) rather than = ANY((select …)): the latter parses
  -- as the set form of ANY and fails with `text = text[]`. This form is hashed
  -- once into a SubPlan, which is what we want anyway.
  or subject::text in (select unnest(private.my_content_subjects()))
);

-- spec_points ---------------------------------------------------------------
drop policy if exists "spec_points read scoped" on public.spec_points;
create policy "spec_points read scoped" on public.spec_points
for select to authenticated
using (
  (select private.has_role((select auth.uid()), 'tutor'::app_role))
  or topic_id in (select unnest(private.my_content_topic_ids()))
);

-- resources -----------------------------------------------------------------
-- `subject` is NOT NULL here, so the array test behaves exactly like the
-- is_enrolled_in / parent-link pair it replaces.
drop policy if exists "resources read scoped" on public.resources;
create policy "resources read scoped" on public.resources
for select to authenticated
using (
  (select private.has_role((select auth.uid()), 'tutor'::app_role))
  -- IN (uncorrelated subquery) rather than = ANY((select …)): the latter parses
  -- as the set form of ANY and fails with `text = text[]`. This form is hashed
  -- once into a SubPlan, which is what we want anyway.
  or subject::text in (select unnest(private.my_content_subjects()))
);

-- mcq_sets ------------------------------------------------------------------
drop policy if exists "mcq_sets read" on public.mcq_sets;
create policy "mcq_sets read" on public.mcq_sets
for select to authenticated
using (
  (select private.has_role((select auth.uid()), 'tutor'::app_role))
  or (published and (select private.viewer_has_content_access((select auth.uid()))))
);

-- mcq_questions -------------------------------------------------------------
-- The access check is hoisted out of the EXISTS; what's left inside is a primary
-- key probe for the set's published flag.
drop policy if exists "mcq_questions read via set" on public.mcq_questions;
create policy "mcq_questions read via set" on public.mcq_questions
for select to authenticated
using (
  (select private.has_role((select auth.uid()), 'tutor'::app_role))
  or (
    (select private.viewer_has_content_access((select auth.uid())))
    and exists (
      select 1 from public.mcq_sets s
      where s.id = mcq_questions.set_id and s.published
    )
  )
);
