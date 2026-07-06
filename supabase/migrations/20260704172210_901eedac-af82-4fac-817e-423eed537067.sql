
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS is_principal boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  IF lower(NEW.email) = 'asa180@live.co.uk' THEN
    INSERT INTO public.user_roles (user_id, role, is_principal) VALUES (NEW.id, 'tutor', true);
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'student');
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

UPDATE public.user_roles ur SET is_principal = true
FROM auth.users u WHERE ur.user_id = u.id AND lower(u.email) = 'asa180@live.co.uk';

INSERT INTO public.user_roles (user_id, role, is_principal)
SELECT u.id, 'tutor'::app_role, true FROM auth.users u
WHERE lower(u.email) = 'asa180@live.co.uk'
  AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id AND ur.role='tutor'::app_role);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject public.subject NOT NULL,
  board public.board NOT NULL,
  level public.level NOT NULL,
  code text,
  title text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.topics TO authenticated;
GRANT ALL ON public.topics TO service_role;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "topics read authed" ON public.topics FOR SELECT TO authenticated USING (true);
CREATE POLICY "topics tutors write" ON public.topics FOR ALL TO authenticated
  USING (private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER t_topics_updated BEFORE UPDATE ON public.topics FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.spec_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spec_points TO authenticated;
GRANT ALL ON public.spec_points TO service_role;
ALTER TABLE public.spec_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spec_points read authed" ON public.spec_points FOR SELECT TO authenticated USING (true);
CREATE POLICY "spec_points tutors write" ON public.spec_points FOR ALL TO authenticated
  USING (private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER t_spec_points_updated BEFORE UPDATE ON public.spec_points FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_spec_points_topic ON public.spec_points(topic_id);

ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS spec_point_id uuid REFERENCES public.spec_points(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_resources_spec_point ON public.resources(spec_point_id);

CREATE TABLE public.mcq_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_point_id uuid REFERENCES public.spec_points(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  published boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mcq_sets TO authenticated;
GRANT ALL ON public.mcq_sets TO service_role;
ALTER TABLE public.mcq_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mcq_sets read" ON public.mcq_sets FOR SELECT TO authenticated
  USING (published OR private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "mcq_sets tutors write" ON public.mcq_sets FOR ALL TO authenticated
  USING (private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER t_mcq_sets_updated BEFORE UPDATE ON public.mcq_sets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.mcq_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES public.mcq_sets(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  question text NOT NULL,
  options jsonb NOT NULL,
  correct_index int NOT NULL,
  explanation text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mcq_questions TO authenticated;
GRANT ALL ON public.mcq_questions TO service_role;
ALTER TABLE public.mcq_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mcq_questions read via set" ON public.mcq_questions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcq_sets s WHERE s.id = set_id
    AND (s.published OR private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role))));
CREATE POLICY "mcq_questions tutors write" ON public.mcq_questions FOR ALL TO authenticated
  USING (private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role));

CREATE TABLE public.mcq_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES public.mcq_sets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  score int NOT NULL,
  total int NOT NULL,
  answers jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.mcq_attempts TO authenticated;
GRANT ALL ON public.mcq_attempts TO service_role;
ALTER TABLE public.mcq_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attempts self insert" ON public.mcq_attempts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "attempts read self or tutor" ON public.mcq_attempts FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role));

CREATE TABLE public.session_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(resource_id, user_id)
);
GRANT SELECT, INSERT ON public.session_attendees TO authenticated;
GRANT ALL ON public.session_attendees TO service_role;
ALTER TABLE public.session_attendees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendees self insert" ON public.session_attendees FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "attendees read self or tutor" ON public.session_attendees FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role));

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text NOT NULL DEFAULT 'inactive',
  plan text,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subs read self or tutor" ON public.subscriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR private.has_role(auth.uid(),'tutor'::app_role) OR private.has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER t_subs_updated BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
