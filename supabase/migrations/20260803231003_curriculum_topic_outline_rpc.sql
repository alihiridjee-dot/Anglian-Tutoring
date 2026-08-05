-- Topic HEADINGS for one course, readable by an enrolled student who has not
-- paid yet.
--
-- Onboarding asks for a confidence rating per topic at step 4, but payment is
-- step 6 — so at that moment `topics` RLS (which requires
-- private.viewer_has_content_access) returns nothing and the step renders
-- blank. Same precedent as public.curriculum_coverage: the pickers can't be
-- gated behind the thing they exist to sell.
--
-- Deliberately headings ONLY. Spec points, resources, videos, MCQs and weekly
-- focus stay behind the subscription — this exposes the chapter list, not the
-- course. Enrolment is still required, so it is not open to any signed-in user.
create or replace function public.curriculum_topic_outline(
  p_level   public.level,
  p_board   public.board,
  p_subject public.subject
)
returns table (
  id          uuid,
  code        text,
  title       text,
  description text,
  sort_order  integer
)
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select t.id, t.code, t.title, t.description, t.sort_order
  from public.topics t
  where t.level   = p_level
    and t.board   = p_board
    and t.subject = p_subject
    and (
      private.has_role((select auth.uid()), 'tutor'::public.app_role)
      or public.is_enrolled_in((select auth.uid()), p_subject)
    )
  order by t.sort_order, t.code
$$;

revoke all on function public.curriculum_topic_outline(public.level, public.board, public.subject) from public, anon;
grant execute on function public.curriculum_topic_outline(public.level, public.board, public.subject) to authenticated;
