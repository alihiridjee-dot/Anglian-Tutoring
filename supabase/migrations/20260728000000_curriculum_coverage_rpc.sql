-- Which level/board/subject combinations actually have curriculum behind them.
--
-- Onboarding needs this to stop offering combinations that lead to an empty
-- app, but it cannot read `topics` directly: the RLS policy there requires
-- is_enrolled_in(), and a student picking their board has no enrolment rows yet
-- (they are written a step later). Hence SECURITY DEFINER — the coverage shape
-- is not sensitive, only the curriculum content behind it is.
create or replace function public.curriculum_coverage()
returns table (
  level public.level,
  board public.board,
  subject public.subject,
  topic_count bigint,
  spec_point_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    t.level,
    t.board,
    t.subject,
    count(distinct t.id) as topic_count,
    count(sp.id)         as spec_point_count
  from public.topics t
  left join public.spec_points sp on sp.topic_id = t.id
  group by t.level, t.board, t.subject
$$;

revoke all on function public.curriculum_coverage() from public;
grant execute on function public.curriculum_coverage() to authenticated, anon;

comment on function public.curriculum_coverage() is
  'Level/board/subject combinations that have curriculum, with topic and spec-point counts. SECURITY DEFINER so onboarding can call it before any enrolment exists.';
