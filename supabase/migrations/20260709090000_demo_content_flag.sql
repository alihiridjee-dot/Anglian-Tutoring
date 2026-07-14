-- ============================================================
-- Demo content model: is_demo flag + scoped RLS
-- Demo mode reads the SAME database as production, scoped to
-- is_demo = true rows via a dedicated demo student account.
-- ============================================================

-- 1. Flag columns
ALTER TABLE public.profiles      ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.topics        ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.spec_points   ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.resources     ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.mcq_sets      ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.mcq_questions ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_topics_is_demo ON public.topics(is_demo);
CREATE INDEX IF NOT EXISTS idx_spec_points_is_demo ON public.spec_points(is_demo);
CREATE INDEX IF NOT EXISTS idx_resources_is_demo ON public.resources(is_demo);
CREATE INDEX IF NOT EXISTS idx_mcq_sets_is_demo ON public.mcq_sets(is_demo);

-- 2. Helper: is the given user a demo user? (SECURITY DEFINER, self-only exposure)
CREATE OR REPLACE FUNCTION private.is_demo_user(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_demo FROM public.profiles WHERE id = _uid), false);
$$;
REVOKE ALL ON FUNCTION private.is_demo_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_demo_user(uuid) TO authenticated, service_role;

-- 3. Rescope SELECT policies so demo <-> production are mutually invisible.
--    Tutors/admins still see both (so they can manage demo content).

DROP POLICY IF EXISTS "topics read authed" ON public.topics;
CREATE POLICY "topics read scoped" ON public.topics FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(),'tutor'::app_role)
    OR private.has_role(auth.uid(),'admin'::app_role)
    OR is_demo = private.is_demo_user(auth.uid())
  );

DROP POLICY IF EXISTS "spec_points read authed" ON public.spec_points;
CREATE POLICY "spec_points read scoped" ON public.spec_points FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(),'tutor'::app_role)
    OR private.has_role(auth.uid(),'admin'::app_role)
    OR is_demo = private.is_demo_user(auth.uid())
  );

DROP POLICY IF EXISTS "resources read scoped" ON public.resources;
CREATE POLICY "resources read scoped" ON public.resources FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(),'tutor'::app_role)
    OR private.has_role(auth.uid(),'admin'::app_role)
    OR (
      is_demo = private.is_demo_user(auth.uid())
      AND (
        public.is_enrolled_in(auth.uid(), subject)
        OR EXISTS (
          SELECT 1 FROM public.parent_student_links l
          JOIN public.profiles p ON p.id = l.student_id
          WHERE l.parent_id = auth.uid() AND p.enrolled_courses @> ARRAY[resources.subject::text]
        )
      )
    )
  );

DROP POLICY IF EXISTS "mcq_sets read" ON public.mcq_sets;
CREATE POLICY "mcq_sets read" ON public.mcq_sets FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(),'tutor'::app_role)
    OR private.has_role(auth.uid(),'admin'::app_role)
    OR (published AND is_demo = private.is_demo_user(auth.uid()))
  );

DROP POLICY IF EXISTS "mcq_questions read via set" ON public.mcq_questions;
CREATE POLICY "mcq_questions read via set" ON public.mcq_questions FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(),'tutor'::app_role)
    OR private.has_role(auth.uid(),'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.mcq_sets s
      WHERE s.id = set_id
        AND s.published
        AND s.is_demo = private.is_demo_user(auth.uid())
    )
  );

-- 4. Extend the signup trigger to auto-provision the dedicated demo student:
--    flag the profile is_demo and enrol it in all three sciences.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  meta_role text;
  final_role public.profile_role;
BEGIN
  meta_role := lower(coalesce(NEW.raw_user_meta_data->>'role', 'student'));
  final_role := CASE
    WHEN meta_role IN ('student', 'parent', 'tutor') THEN meta_role::public.profile_role
    ELSE 'student'::public.profile_role
  END;

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

  -- Dedicated public demo student: flag as demo and enrol in all sciences.
  IF lower(NEW.email) = 'demo.student@angliantutoring.app' THEN
    UPDATE public.profiles
      SET is_demo = true,
          enrolled_courses = ARRAY['biology','chemistry','physics']
      WHERE id = NEW.id;
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
