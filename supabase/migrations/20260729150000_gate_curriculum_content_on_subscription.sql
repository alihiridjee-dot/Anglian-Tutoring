-- Make the paywall real.
--
-- Until now private.student_has_access() was referenced by exactly zero RLS
-- policies: the paywall was a frosted overlay in the router and nothing more.
-- Content was gated on ENROLMENT (is_enrolled_in), which survives a cancelled
-- or paused subscription, so a lapsed student's JWT still read the whole
-- curriculum straight out of PostgREST.
--
-- private.viewer_has_content_access() answers "may this caller see paid
-- curriculum content at all", per identity:
--   tutor   - always (they author it)
--   student - only while their own subscription is live (active/trialing and
--             not past its period end). 'paused' is written as a distinct
--             status by the webhook, so pausing suspends access, as intended.
--   parent  - only while at least one linked child's subscription is live;
--             a parent must not keep reading content a lapsed family stopped
--             paying for.
--   anyone else (no profile row) - false.
--
-- It is layered on TOP of the existing quals with AND, so all current
-- enrolment/subject scoping is preserved unchanged; this only ever removes
-- access, never grants it.
--
-- Deliberately NOT gated: a student's own records (submissions, confidence,
-- reviews, schedule, plans), billing, profile and notifications. A lapsed
-- student keeps their history and can resubscribe to restore everything.
create or replace function private.viewer_has_content_access(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private'
as $function$
  select case
    when p_uid is null then false
    when private.has_role(p_uid, 'tutor'::app_role) then true
    when exists (select 1 from public.profiles p where p.id = p_uid and p.role = 'student')
      then private.student_has_access(p_uid)
    when exists (select 1 from public.profiles p where p.id = p_uid and p.role = 'parent')
      then exists (
        select 1 from public.parent_student_links l
        where l.parent_id = p_uid
          and private.student_has_access(l.student_id)
      )
    else false
  end
$function$;

revoke all on function private.viewer_has_content_access(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- topics
drop policy if exists "topics read scoped" on public.topics;
create policy "topics read scoped" on public.topics for select to authenticated
using (
  private.viewer_has_content_access((select auth.uid()))
  and (
    private.has_role((select auth.uid()), 'tutor'::app_role)
    or is_enrolled_in((select auth.uid()), subject)
    or exists (
      select 1 from parent_student_links l
      join profiles p on p.id = l.student_id
      where l.parent_id = (select auth.uid())
        and p.enrolled_courses @> array[topics.subject::text]
    )
  )
);

-- ----------------------------------------------------------- spec_points
drop policy if exists "spec_points read scoped" on public.spec_points;
create policy "spec_points read scoped" on public.spec_points for select to authenticated
using (
  private.viewer_has_content_access((select auth.uid()))
  and (
    private.has_role((select auth.uid()), 'tutor'::app_role)
    or exists (
      select 1 from topics t
      where t.id = spec_points.topic_id
        and (
          is_enrolled_in((select auth.uid()), t.subject)
          or exists (
            select 1 from parent_student_links l
            join profiles p on p.id = l.student_id
            where l.parent_id = (select auth.uid())
              and p.enrolled_courses @> array[t.subject::text]
          )
        )
    )
  )
);

-- ------------------------------------------------------------- resources
drop policy if exists "resources read scoped" on public.resources;
create policy "resources read scoped" on public.resources for select to authenticated
using (
  private.viewer_has_content_access((select auth.uid()))
  and (
    private.has_role((select auth.uid()), 'tutor'::app_role)
    or is_enrolled_in((select auth.uid()), subject)
    or exists (
      select 1 from parent_student_links l
      join profiles p on p.id = l.student_id
      where l.parent_id = (select auth.uid())
        and p.enrolled_courses @> array[resources.subject::text]
    )
  )
);

-- -------------------------------------------------- resource_spec_points
-- Follows the resource: RLS applies to tables referenced inside a policy
-- qual too, so if the resources row is invisible under the policy above,
-- this EXISTS finds nothing and the join row is invisible as well.
drop policy if exists "rsp read follows resource" on public.resource_spec_points;
create policy "rsp read follows resource" on public.resource_spec_points for select to authenticated
using (
  exists (select 1 from resources r where r.id = resource_spec_points.resource_id)
);

-- -------------------------------------------------------------- mcq_sets
-- Previously: tutor OR published — i.e. every authenticated user could read
-- every published set, with no enrolment or subscription check whatsoever.
drop policy if exists "mcq_sets read" on public.mcq_sets;
create policy "mcq_sets read" on public.mcq_sets for select to authenticated
using (
  private.has_role((select auth.uid()), 'tutor'::app_role)
  or (published and private.viewer_has_content_access((select auth.uid())))
);

-- --------------------------------------------------------- mcq_questions
drop policy if exists "mcq_questions read via set" on public.mcq_questions;
create policy "mcq_questions read via set" on public.mcq_questions for select to authenticated
using (
  private.has_role((select auth.uid()), 'tutor'::app_role)
  or exists (
    select 1 from mcq_sets s
    where s.id = mcq_questions.set_id
      and s.published
      and private.viewer_has_content_access((select auth.uid()))
  )
);

-- ---------------------------------------------------------- weekly_focus
-- Previously: qual = true. Unconditional read for every authenticated user.
drop policy if exists "weekly_focus read authed" on public.weekly_focus;
create policy "weekly_focus read authed" on public.weekly_focus for select to authenticated
using (private.viewer_has_content_access((select auth.uid())));

drop policy if exists "weekly_focus_points read authed" on public.weekly_focus_points;
create policy "weekly_focus_points read authed" on public.weekly_focus_points for select to authenticated
using (private.viewer_has_content_access((select auth.uid())));
