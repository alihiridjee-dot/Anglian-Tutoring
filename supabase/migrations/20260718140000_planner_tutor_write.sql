-- Phase 4: let tutors adjust a student's weekly plan.
--
-- Until now tutors could only READ student plans (the `wp tutor` / `wpp tutor`
-- SELECT policies). The planner's tutor view needs to add/remove spec points and
-- edit the note on any student's week, so we widen those to FOR ALL. The
-- student's own FOR ALL policy is untouched — RLS permissive policies OR
-- together, so a student still manages only their own rows while a tutor/admin
-- can manage anyone's. Check-ins stay student-owned (tutors read, don't write).

-- student_weekly_plans: replace tutor SELECT with tutor FOR ALL.
drop policy if exists "wp tutor" on public.student_weekly_plans;
create policy "wp tutor" on public.student_weekly_plans for all to authenticated
  using (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role))
  with check (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role));

-- student_weekly_plan_points: replace tutor SELECT with tutor FOR ALL.
drop policy if exists "wpp tutor" on public.student_weekly_plan_points;
create policy "wpp tutor" on public.student_weekly_plan_points for all to authenticated
  using (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role))
  with check (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role));
