
-- Pin search_path on new trigger function
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.student_invite_code IS NULL THEN
    NEW.student_invite_code := 'ANG-' || upper(substr(md5(NEW.id::text || clock_timestamp()::text), 1, 6));
  END IF;
  RETURN NEW;
END;
$$;

-- Restrict SECURITY DEFINER helper to authenticated only
REVOKE ALL ON FUNCTION public.is_enrolled_in(uuid, public.subject) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_enrolled_in(uuid, public.subject) TO authenticated;

-- Same for existing helper if it was open
REVOKE ALL ON FUNCTION public.generate_invite_code() FROM PUBLIC;
