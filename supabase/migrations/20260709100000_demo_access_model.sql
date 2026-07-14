-- ============================================================
-- Shared-content demo access model.
-- Demo and real accounts read the SAME curriculum rows. Demo accounts are
-- differentiated ONLY by access restrictions on MCQs, homework, and live
-- sessions — enforced here at the RLS layer, not in the frontend.
--   * Curriculum (topics, spec points, videos): fully visible to demo.
--   * MCQ sets: demo sees only the pinned (demo_visible) set.
--   * Homework: demo sees only the pinned (demo_visible) resource.
--   * Live sessions: demo sees none.
-- profiles.is_demo + private.is_demo_user() are retained to identify demo users.
-- ============================================================

-- 1. Drop the previous "separate demo dataset" policies + flags.
DROP POLICY IF EXISTS "topics read scoped" ON public.topics;
DROP POLICY IF EXISTS "spec_points read scoped" ON public.spec_points;
DROP POLICY IF EXISTS "resources read scoped" ON public.resources;
DROP POLICY IF EXISTS "mcq_sets read" ON public.mcq_sets;
DROP POLICY IF EXISTS "mcq_questions read via set" ON public.mcq_questions;

ALTER TABLE public.topics        DROP COLUMN IF EXISTS is_demo;
ALTER TABLE public.spec_points   DROP COLUMN IF EXISTS is_demo;
ALTER TABLE public.resources     DROP COLUMN IF EXISTS is_demo;
ALTER TABLE public.mcq_sets      DROP COLUMN IF EXISTS is_demo;
ALTER TABLE public.mcq_questions DROP COLUMN IF EXISTS is_demo;

-- 2. Pin flags: the single demo-visible MCQ set / homework resource.
ALTER TABLE public.mcq_sets  ADD COLUMN IF NOT EXISTS demo_visible boolean NOT NULL DEFAULT false;
ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS demo_visible boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_mcq_sets_demo_visible ON public.mcq_sets(demo_visible) WHERE demo_visible;
CREATE INDEX IF NOT EXISTS idx_resources_demo_visible ON public.resources(demo_visible) WHERE demo_visible;

-- 3. Curriculum is public to any signed-in user (demo or real).
CREATE POLICY "topics read authed" ON public.topics
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "spec_points read authed" ON public.spec_points
  FOR SELECT TO authenticated USING (true);

-- 4. Resources: enrolment-scoped as before, PLUS demo restriction.
--    Demo accounts: videos/downloads OK; homework only if pinned; live blocked.
CREATE POLICY "resources read scoped" ON public.resources
  FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(),'tutor'::app_role)
    OR private.has_role(auth.uid(),'admin'::app_role)
    OR (
      (
        public.is_enrolled_in(auth.uid(), subject)
        OR EXISTS (
          SELECT 1 FROM public.parent_student_links l
          JOIN public.profiles p ON p.id = l.student_id
          WHERE l.parent_id = auth.uid() AND p.enrolled_courses @> ARRAY[resources.subject::text]
        )
      )
      AND (
        NOT private.is_demo_user(auth.uid())
        OR kind = 'video'::resource_kind
        OR kind = 'download'::resource_kind
        OR (kind = 'homework'::resource_kind AND demo_visible)
      )
    )
  );

-- 5. MCQ sets: published to real accounts; demo accounts only the pinned set.
CREATE POLICY "mcq_sets read" ON public.mcq_sets
  FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(),'tutor'::app_role)
    OR private.has_role(auth.uid(),'admin'::app_role)
    OR (published AND (NOT private.is_demo_user(auth.uid()) OR demo_visible))
  );

CREATE POLICY "mcq_questions read via set" ON public.mcq_questions
  FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(),'tutor'::app_role)
    OR private.has_role(auth.uid(),'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.mcq_sets s
      WHERE s.id = set_id
        AND s.published
        AND (NOT private.is_demo_user(auth.uid()) OR s.demo_visible)
    )
  );
