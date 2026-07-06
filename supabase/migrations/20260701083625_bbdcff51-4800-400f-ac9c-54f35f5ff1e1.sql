
-- Enums
CREATE TYPE public.app_role AS ENUM ('student','tutor','admin');
CREATE TYPE public.subject AS ENUM ('biology','chemistry','physics');
CREATE TYPE public.board AS ENUM ('edexcel','aqa','ocr');
CREATE TYPE public.level AS ENUM ('gcse','alevel');
CREATE TYPE public.resource_kind AS ENUM ('video','download','live_session','homework');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles self read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles self insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles self read" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- Auto-create profile + default student role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'student');
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Shared resource table
CREATE TABLE public.resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind public.resource_kind NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  subject public.subject NOT NULL,
  board public.board NOT NULL,
  level public.level NOT NULL,
  -- video
  video_url TEXT,
  duration_seconds INT,
  -- download / homework attachments (paths in storage bucket 'resources')
  file_path TEXT,
  file_name TEXT,
  file_mime TEXT,
  file_size BIGINT,
  mark_scheme_path TEXT,
  mark_scheme_name TEXT,
  -- live session
  starts_at TIMESTAMPTZ,
  join_url TEXT,
  -- homework
  due_at TIMESTAMPTZ,
  instructions TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX resources_kind_idx ON public.resources(kind);
CREATE INDEX resources_filter_idx ON public.resources(subject, board, level);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.resources TO authenticated;
GRANT ALL ON public.resources TO service_role;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resources read for signed in" ON public.resources
FOR SELECT TO authenticated USING (true);

CREATE POLICY "resources tutors insert" ON public.resources
FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(),'tutor') OR public.has_role(auth.uid(),'admin')
);

CREATE POLICY "resources tutors update" ON public.resources
FOR UPDATE TO authenticated USING (
  public.has_role(auth.uid(),'tutor') OR public.has_role(auth.uid(),'admin')
);

CREATE POLICY "resources tutors delete" ON public.resources
FOR DELETE TO authenticated USING (
  public.has_role(auth.uid(),'tutor') OR public.has_role(auth.uid(),'admin')
);

-- Storage policies for 'resources' bucket (bucket created via storage tool)
CREATE POLICY "resources bucket read" ON storage.objects
FOR SELECT TO authenticated USING (bucket_id = 'resources');

CREATE POLICY "resources bucket tutors write" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'resources' AND (
    public.has_role(auth.uid(),'tutor') OR public.has_role(auth.uid(),'admin')
  )
);

CREATE POLICY "resources bucket tutors update" ON storage.objects
FOR UPDATE TO authenticated USING (
  bucket_id = 'resources' AND (
    public.has_role(auth.uid(),'tutor') OR public.has_role(auth.uid(),'admin')
  )
);

CREATE POLICY "resources bucket tutors delete" ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'resources' AND (
    public.has_role(auth.uid(),'tutor') OR public.has_role(auth.uid(),'admin')
  )
);
