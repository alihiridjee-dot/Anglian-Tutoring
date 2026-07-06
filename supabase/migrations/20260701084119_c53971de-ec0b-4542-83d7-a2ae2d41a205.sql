
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;

-- Recreate resource + storage policies to use private.has_role
DROP POLICY IF EXISTS "resources tutors insert" ON public.resources;
DROP POLICY IF EXISTS "resources tutors update" ON public.resources;
DROP POLICY IF EXISTS "resources tutors delete" ON public.resources;
CREATE POLICY "resources tutors insert" ON public.resources
FOR INSERT TO authenticated WITH CHECK (
  private.has_role(auth.uid(),'tutor') OR private.has_role(auth.uid(),'admin')
);
CREATE POLICY "resources tutors update" ON public.resources
FOR UPDATE TO authenticated USING (
  private.has_role(auth.uid(),'tutor') OR private.has_role(auth.uid(),'admin')
);
CREATE POLICY "resources tutors delete" ON public.resources
FOR DELETE TO authenticated USING (
  private.has_role(auth.uid(),'tutor') OR private.has_role(auth.uid(),'admin')
);

DROP POLICY IF EXISTS "resources bucket tutors write" ON storage.objects;
DROP POLICY IF EXISTS "resources bucket tutors update" ON storage.objects;
DROP POLICY IF EXISTS "resources bucket tutors delete" ON storage.objects;
CREATE POLICY "resources bucket tutors write" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'resources' AND (private.has_role(auth.uid(),'tutor') OR private.has_role(auth.uid(),'admin'))
);
CREATE POLICY "resources bucket tutors update" ON storage.objects
FOR UPDATE TO authenticated USING (
  bucket_id = 'resources' AND (private.has_role(auth.uid(),'tutor') OR private.has_role(auth.uid(),'admin'))
);
CREATE POLICY "resources bucket tutors delete" ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'resources' AND (private.has_role(auth.uid(),'tutor') OR private.has_role(auth.uid(),'admin'))
);

DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
