
DROP POLICY IF EXISTS "leads public insert" ON public.leads;
CREATE POLICY "leads public insert" ON public.leads
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(email) BETWEEN 3 AND 320
    AND char_length(name) BETWEEN 1 AND 200
    AND char_length(message) BETWEEN 1 AND 4000
    AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  );
