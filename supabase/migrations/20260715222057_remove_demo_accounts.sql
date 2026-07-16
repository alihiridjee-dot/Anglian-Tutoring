-- ============================================================
-- Remove the demo-account model.
--
-- The public demo is now a session-less UI showcase under /demo/*, rendering
-- hardcoded fixtures. There is no demo account, so nothing in the database
-- needs to identify one: profiles.is_demo, private.is_demo_user(), the
-- demo_visible pins and the signup trigger's demo branch are all dead weight.
--
-- PRECONDITION — run these first, or this migration silently widens access:
--   1. delete the demo.parent@angliantutoring.app account (the only is_demo=true
--      row). Dropping the demo predicates below removes the ONLY restriction on
--      it, so a surviving demo.parent would gain the full homework/MCQ catalogue.
--   2. rename demo.student@angliantutoring.app -> 123@123.com. It is already
--      is_demo=false and keeps its enrolment, so it simply becomes an ordinary
--      test student.
-- ============================================================

-- 1. Policies lose their demo carve-outs. Enrolment (and the parent link) is
--    now the whole story for a non-tutor.
DROP POLICY IF EXISTS "resources read scoped" ON public.resources;
CREATE POLICY "resources read scoped" ON public.resources
  FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(),'tutor'::app_role)
    OR private.has_role(auth.uid(),'admin'::app_role)
    OR public.is_enrolled_in(auth.uid(), subject)
    OR EXISTS (
      SELECT 1 FROM public.parent_student_links l
      JOIN public.profiles p ON p.id = l.student_id
      WHERE l.parent_id = auth.uid() AND p.enrolled_courses @> ARRAY[resources.subject::text]
    )
  );

DROP POLICY IF EXISTS "mcq_sets read" ON public.mcq_sets;
CREATE POLICY "mcq_sets read" ON public.mcq_sets
  FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(),'tutor'::app_role)
    OR private.has_role(auth.uid(),'admin'::app_role)
    OR published
  );

DROP POLICY IF EXISTS "mcq_questions read via set" ON public.mcq_questions;
CREATE POLICY "mcq_questions read via set" ON public.mcq_questions
  FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(),'tutor'::app_role)
    OR private.has_role(auth.uid(),'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.mcq_sets s
      WHERE s.id = set_id AND s.published
    )
  );

-- 2. Drop the flags and the helper that read them.
DROP INDEX IF EXISTS public.idx_mcq_sets_demo_visible;
DROP INDEX IF EXISTS public.idx_resources_demo_visible;
ALTER TABLE public.mcq_sets  DROP COLUMN IF EXISTS demo_visible;
ALTER TABLE public.resources DROP COLUMN IF EXISTS demo_visible;

DROP INDEX IF EXISTS public.idx_topics_is_demo;
DROP INDEX IF EXISTS public.idx_spec_points_is_demo;
DROP INDEX IF EXISTS public.idx_resources_is_demo;
DROP INDEX IF EXISTS public.idx_mcq_sets_is_demo;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_demo;

DROP FUNCTION IF EXISTS private.is_demo_user(uuid);

-- 3. Signup trigger: drop the demo.student special-casing. Identical to the
--    previous version minus the two demo branches.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  meta_role text;
  final_role public.profile_role;
  signup_tier text;
  signup_level text;
BEGIN
  meta_role := lower(coalesce(NEW.raw_user_meta_data->>'role', 'student'));
  final_role := CASE
    WHEN meta_role IN ('student', 'parent', 'tutor') THEN meta_role::public.profile_role
    ELSE 'student'::public.profile_role
  END;
  signup_tier  := NEW.raw_user_meta_data->>'signup_tier';
  signup_level := NEW.raw_user_meta_data->>'signup_level';

  INSERT INTO public.profiles (id, display_name, role, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    final_role,
    NEW.raw_user_meta_data->>'phone'
  );

  IF lower(NEW.email) = 'asa180@live.co.uk' THEN
    INSERT INTO public.user_roles (user_id, role, is_principal) VALUES (NEW.id, 'tutor', true);
    UPDATE public.profiles SET role = 'tutor' WHERE id = NEW.id;
  ELSIF final_role = 'tutor' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'tutor');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'student');
  END IF;

  -- Plan enrolment: a student who signed up via a pricing plan is enrolled in
  -- the three sciences and gets a subscription record for their chosen tier.
  IF final_role = 'student' AND (signup_tier IS NOT NULL OR signup_level IS NOT NULL) THEN
    UPDATE public.profiles
      SET enrolled_courses = ARRAY['biology','chemistry','physics']
      WHERE id = NEW.id;
    INSERT INTO public.subscriptions (user_id, plan, status)
      VALUES (NEW.id, COALESCE(signup_tier, signup_level), 'trialing')
      ON CONFLICT (user_id) DO UPDATE
        SET plan = EXCLUDED.plan, status = EXCLUDED.status, updated_at = now();
  END IF;

  -- Auto-link parents via invite code
  IF final_role = 'parent' AND NEW.raw_user_meta_data->>'parent_invite_code' IS NOT NULL THEN
    INSERT INTO public.parent_student_links (parent_id, student_id)
    SELECT NEW.id, p.id FROM public.profiles p
    WHERE p.student_invite_code = upper(NEW.raw_user_meta_data->>'parent_invite_code');
  END IF;

  RETURN NEW;
END;
$$;
