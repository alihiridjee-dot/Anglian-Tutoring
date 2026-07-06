-- Security Fixes Migration

-- 1. All authenticated users can read every resource regardless of enrollment
-- Drop the overly permissive legacy policy on public.resources
DROP POLICY IF EXISTS "resources read for signed in" ON public.resources;

-- 2. Any authenticated user can download all private resource files
-- Drop the overly permissive storage policy on storage.objects
DROP POLICY IF EXISTS "resources bucket read" ON storage.objects;

-- Create a secure, scope-restricted SELECT policy for storage.objects
CREATE POLICY "resources bucket read scoped" ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'resources' AND (
    private.has_role(auth.uid(), 'tutor'::public.app_role)
    OR private.has_role(auth.uid(), 'admin'::public.app_role)
    -- Homework submission files: users can read their own or their linked children's submissions
    OR (
      name LIKE 'submissions/%' AND (
        name LIKE 'submissions/' || auth.uid()::text || '/%'
        OR EXISTS (
          SELECT 1 FROM public.parent_student_links l
          WHERE l.parent_id = auth.uid()
          AND name LIKE 'submissions/' || l.student_id::text || '/%'
        )
      )
    )
    -- Regular resource files: users can read if they (or their child) are enrolled in the subject
    OR EXISTS (
      SELECT 1 FROM public.resources r
      WHERE (r.file_path = name OR r.mark_scheme_path = name)
      AND (
        public.is_enrolled_in(auth.uid(), r.subject)
        OR EXISTS (
          SELECT 1 FROM public.parent_student_links l
          JOIN public.profiles p ON p.id = l.student_id
          WHERE l.parent_id = auth.uid() AND p.enrolled_courses @> ARRAY[r.subject::text]
        )
      )
    )
  )
);

-- Allow students to upload (INSERT) their own homework submissions under their student subfolder
DROP POLICY IF EXISTS "resources bucket student upload" ON storage.objects;
CREATE POLICY "resources bucket student upload" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'resources' AND
  name LIKE 'submissions/' || auth.uid()::text || '/%'
);

-- 4. Signed-In Users Can Execute SECURITY DEFINER Function
-- Revoke PUBLIC execute permission from the high-privilege handle_new_user trigger function
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Harden is_enrolled_in SECURITY DEFINER function to prevent checking other users' info without auth
CREATE OR REPLACE FUNCTION public.is_enrolled_in(_user_id uuid, _subject public.subject)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only allow checking own enrollment unless the caller is a tutor or admin
  IF _user_id = auth.uid() 
     OR private.has_role(auth.uid(), 'tutor'::public.app_role) 
     OR private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = _user_id AND p.enrolled_courses @> ARRAY[_subject::text]
    );
  ELSE
    RETURN false;
  END IF;
END;
$$;

-- Harden private.has_role SECURITY DEFINER function to prevent checking other users' roles without auth
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only allow checking own roles unless the caller is a tutor or admin
  IF _user_id = auth.uid() THEN
    RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
  ELSIF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('tutor'::public.app_role, 'admin'::public.app_role)) THEN
    RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
  ELSE
    RETURN false;
  END IF;
END;
$$;
