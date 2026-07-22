-- Curriculum structure lockdown: gate topics + spec_points by enrolment.
--
-- The bug: `resources` (files/videos) were already scoped by is_enrolled_in, but
-- `topics` and `spec_points` were SELECT-able by ANY authenticated user
-- ("read authed" USING true). So a student paying for one subject could browse
-- every other subject's curriculum structure and specification points from the
-- curriculum page's subject dropdown — content their subscription doesn't cover.
--
-- Fix: scope both tables to the caller's enrolment, mirroring the resources
-- policy exactly (tutor sees all; a student sees a subject only if enrolled in
-- it; a parent sees a subject their linked child is enrolled in). enrolled_courses
-- is kept equal to the subjects the active subscription pays for (onboarding and
-- the add-subject upgrade both write it in lockstep with the plan), so "enrolled"
-- means "paid for", and this is the authoritative, server-side guardrail behind
-- the client-side greying.
--
-- spec_points carries no subject of its own — it hangs off a topic — so it is
-- gated through its parent topic's subject.

-- --- topics -----------------------------------------------------------------

drop policy if exists "topics read authed" on public.topics;

create policy "topics read scoped" on public.topics
  for select to authenticated
  using (
    private.has_role(auth.uid(), 'tutor'::public.app_role)
    or public.is_enrolled_in(auth.uid(), subject)
    or exists (
      select 1
      from public.parent_student_links l
      join public.profiles p on p.id = l.student_id
      where l.parent_id = auth.uid()
        and p.enrolled_courses @> array[topics.subject::text]
    )
  );

-- --- spec_points (gated through its topic) ----------------------------------

drop policy if exists "spec_points read authed" on public.spec_points;

create policy "spec_points read scoped" on public.spec_points
  for select to authenticated
  using (
    private.has_role(auth.uid(), 'tutor'::public.app_role)
    or exists (
      select 1 from public.topics t
      where t.id = spec_points.topic_id
        and (
          public.is_enrolled_in(auth.uid(), t.subject)
          or exists (
            select 1
            from public.parent_student_links l
            join public.profiles p on p.id = l.student_id
            where l.parent_id = auth.uid()
              and p.enrolled_courses @> array[t.subject::text]
          )
        )
    )
  );
