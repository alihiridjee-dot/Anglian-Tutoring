-- On signup, enrol students into their chosen plan and record the plan.
-- All current plans (KS3 / GCSE combined / GCSE triple) cover the three
-- sciences, so enrolment grants biology, chemistry, and physics. The chosen
-- billing tier + level are recorded on a subscriptions row.
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

  -- Dedicated public demo student: flag as demo and enrol in all sciences.
  IF lower(NEW.email) = 'demo.student@angliantutoring.app' THEN
    UPDATE public.profiles
      SET is_demo = true,
          enrolled_courses = ARRAY['biology','chemistry','physics']
      WHERE id = NEW.id;
  END IF;

  -- Plan enrolment: a student who signed up via a pricing plan is enrolled in
  -- the three sciences and gets a subscription record for their chosen tier.
  IF final_role = 'student'
     AND (signup_tier IS NOT NULL OR signup_level IS NOT NULL)
     AND lower(NEW.email) <> 'demo.student@angliantutoring.app' THEN
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
