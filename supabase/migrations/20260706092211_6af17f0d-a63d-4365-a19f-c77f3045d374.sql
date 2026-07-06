
-- ============================================================
-- Anglian Tutoring — schema expansion
-- ============================================================

-- 1. Profiles: role, enrolments, parent invite code
CREATE TYPE public.profile_role AS ENUM ('student', 'parent', 'tutor');

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role public.profile_role NOT NULL DEFAULT 'student',
  ADD COLUMN IF NOT EXISTS enrolled_courses text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS student_invite_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS phone text;

-- Ensure every existing student has an invite code
UPDATE public.profiles
SET student_invite_code = 'ANG-' || upper(substr(md5(id::text), 1, 6))
WHERE student_invite_code IS NULL;

-- Generate invite code on insert
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.student_invite_code IS NULL THEN
    NEW.student_invite_code := 'ANG-' || upper(substr(md5(NEW.id::text || clock_timestamp()::text), 1, 6));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS t_profiles_invite_code ON public.profiles;
CREATE TRIGGER t_profiles_invite_code BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.generate_invite_code();

-- Update the auth trigger to propagate signup metadata
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

  -- Auto-link parents via invite code
  IF final_role = 'parent' AND NEW.raw_user_meta_data->>'parent_invite_code' IS NOT NULL THEN
    INSERT INTO public.parent_student_links (parent_id, student_id)
    SELECT NEW.id, p.id FROM public.profiles p
    WHERE p.student_invite_code = upper(NEW.raw_user_meta_data->>'parent_invite_code');
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Parent <-> student links
CREATE TABLE IF NOT EXISTS public.parent_student_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL,
  student_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(parent_id, student_id)
);
GRANT SELECT, INSERT, DELETE ON public.parent_student_links TO authenticated;
GRANT ALL ON public.parent_student_links TO service_role;
ALTER TABLE public.parent_student_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "psl parent reads own"
  ON public.parent_student_links FOR SELECT TO authenticated
  USING (auth.uid() = parent_id OR auth.uid() = student_id
         OR private.has_role(auth.uid(),'tutor'::app_role)
         OR private.has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "psl tutor writes"
  ON public.parent_student_links FOR ALL TO authenticated
  USING (private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role));

-- 3. Leads (contact form)
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  message text NOT NULL,
  handled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.leads TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads public insert" ON public.leads
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "leads tutor read" ON public.leads
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "leads tutor update" ON public.leads
  FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role));

-- 4. Packages (pricing tiers)
CREATE TABLE IF NOT EXISTS public.packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  subjects text[] NOT NULL DEFAULT '{}',
  level text,
  price_pence int NOT NULL,
  stripe_price_id text,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.packages TO anon, authenticated;
GRANT ALL ON public.packages TO service_role;
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "packages public read" ON public.packages
  FOR SELECT TO anon, authenticated USING (active);
CREATE POLICY "packages tutor manage" ON public.packages
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role));

INSERT INTO public.packages (tier, name, description, subjects, level, price_pence, sort_order) VALUES
  ('ks3', 'KS3 Science', 'Weekly live lessons across all 3 sciences for KS3 students.', ARRAY['biology','chemistry','physics'], 'ks3', 2900, 10),
  ('gcse_single', 'GCSE Single Subject', 'One GCSE science, weekly live lessons, MCQs, homework.', ARRAY[]::text[], 'gcse', 3900, 20),
  ('gcse_triple', 'GCSE Triple Science', 'Biology + Chemistry + Physics for GCSE.', ARRAY['biology','chemistry','physics'], 'gcse', 7900, 30),
  ('aqa_trilogy', 'AQA Combined Trilogy', 'Combined-science route for AQA.', ARRAY['biology','chemistry','physics'], 'gcse', 6500, 40)
ON CONFLICT (tier) DO NOTHING;

-- 5. Homework submissions
CREATE TABLE IF NOT EXISTS public.homework_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  grade text,
  score_pct numeric(5,2),
  feedback text,
  graded_by uuid,
  graded_at timestamptz,
  UNIQUE(resource_id, student_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.homework_submissions TO authenticated;
GRANT ALL ON public.homework_submissions TO service_role;
ALTER TABLE public.homework_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hs student own"
  ON public.homework_submissions FOR ALL TO authenticated
  USING (auth.uid() = student_id
         OR private.has_role(auth.uid(),'tutor'::app_role)
         OR private.has_role(auth.uid(),'admin'::app_role)
         OR EXISTS (SELECT 1 FROM public.parent_student_links l
                    WHERE l.parent_id = auth.uid() AND l.student_id = homework_submissions.student_id))
  WITH CHECK (auth.uid() = student_id
              OR private.has_role(auth.uid(),'tutor'::app_role)
              OR private.has_role(auth.uid(),'admin'::app_role));

-- 6. Week number on MCQ sets
ALTER TABLE public.mcq_sets
  ADD COLUMN IF NOT EXISTS week_number int,
  ADD COLUMN IF NOT EXISTS subject public.subject;

-- 7. Extended profile RLS: parents can read linked students
DROP POLICY IF EXISTS "profiles parent reads linked" ON public.profiles;
CREATE POLICY "profiles parent reads linked" ON public.profiles
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.parent_student_links l
                 WHERE l.parent_id = auth.uid() AND l.student_id = profiles.id));

-- 8. Enrolment-scoped resource reads for students
CREATE OR REPLACE FUNCTION public.is_enrolled_in(_user_id uuid, _subject public.subject)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id AND p.enrolled_courses @> ARRAY[_subject::text]
  );
$$;

-- Tighten resource SELECT: students only see subjects they're enrolled in.
DROP POLICY IF EXISTS "resources read authed" ON public.resources;
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

-- 9. Indexes for scale
CREATE INDEX IF NOT EXISTS idx_resources_subject ON public.resources(subject);
CREATE INDEX IF NOT EXISTS idx_resources_kind_subject ON public.resources(kind, subject);
CREATE INDEX IF NOT EXISTS idx_resources_created_by ON public.resources(created_by);
CREATE INDEX IF NOT EXISTS idx_mcq_attempts_user ON public.mcq_attempts(user_id, set_id);
CREATE INDEX IF NOT EXISTS idx_mcq_sets_subject_week ON public.mcq_sets(subject, week_number);
CREATE INDEX IF NOT EXISTS idx_homework_submissions_student ON public.homework_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_homework_submissions_resource ON public.homework_submissions(resource_id);
CREATE INDEX IF NOT EXISTS idx_session_attendees_resource ON public.session_attendees(resource_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_parent_student_links_parent ON public.parent_student_links(parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_student_links_student ON public.parent_student_links(student_id);
CREATE INDEX IF NOT EXISTS idx_profiles_enrolled ON public.profiles USING gin (enrolled_courses);
CREATE INDEX IF NOT EXISTS idx_profiles_invite_code ON public.profiles(student_invite_code);
