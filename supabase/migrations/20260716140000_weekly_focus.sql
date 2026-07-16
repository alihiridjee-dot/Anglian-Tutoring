-- "This Week" widget: tutors pick the curriculum spec points in focus for a
-- given week; students see them on their dashboard. A plan is keyed by the
-- Monday that starts its week (a tz-agnostic date), scoped to one
-- subject/board/level — the taxonomy that its spec points belong to. There is
-- no destructive weekly reset: "this week" is derived from today's date, so a
-- new week simply has no plan yet until the tutor sets one (their Monday prompt).

CREATE TABLE IF NOT EXISTS public.weekly_focus (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start  date NOT NULL,
  subject     public.subject NOT NULL,
  board       public.board NOT NULL,
  level       public.level NOT NULL,
  note        text,
  created_by  uuid NOT NULL REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_start, subject, board, level)
);

-- Spec points in focus for a plan. Cascades so clearing a plan or a point
-- never leaves dangling links.
CREATE TABLE IF NOT EXISTS public.weekly_focus_points (
  focus_id       uuid NOT NULL REFERENCES public.weekly_focus(id) ON DELETE CASCADE,
  spec_point_id  uuid NOT NULL REFERENCES public.spec_points(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (focus_id, spec_point_id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_focus_week ON public.weekly_focus(week_start);
CREATE INDEX IF NOT EXISTS idx_weekly_focus_week_subject ON public.weekly_focus(week_start, subject);
CREATE INDEX IF NOT EXISTS idx_weekly_focus_points_point ON public.weekly_focus_points(spec_point_id);

ALTER TABLE public.weekly_focus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_focus_points ENABLE ROW LEVEL SECURITY;

-- Any signed-in user may read the plan (students need to see what to cover);
-- only tutors/admins may write it.
CREATE POLICY "weekly_focus read authed" ON public.weekly_focus
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "weekly_focus tutors insert" ON public.weekly_focus
  FOR INSERT TO authenticated WITH CHECK (
    private.has_role(auth.uid(),'tutor'::app_role)
    OR private.has_role(auth.uid(),'admin'::app_role)
  );

CREATE POLICY "weekly_focus tutors update" ON public.weekly_focus
  FOR UPDATE TO authenticated USING (
    private.has_role(auth.uid(),'tutor'::app_role)
    OR private.has_role(auth.uid(),'admin'::app_role)
  );

CREATE POLICY "weekly_focus tutors delete" ON public.weekly_focus
  FOR DELETE TO authenticated USING (
    private.has_role(auth.uid(),'tutor'::app_role)
    OR private.has_role(auth.uid(),'admin'::app_role)
  );

CREATE POLICY "weekly_focus_points read authed" ON public.weekly_focus_points
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "weekly_focus_points tutors insert" ON public.weekly_focus_points
  FOR INSERT TO authenticated WITH CHECK (
    private.has_role(auth.uid(),'tutor'::app_role)
    OR private.has_role(auth.uid(),'admin'::app_role)
  );

CREATE POLICY "weekly_focus_points tutors delete" ON public.weekly_focus_points
  FOR DELETE TO authenticated USING (
    private.has_role(auth.uid(),'tutor'::app_role)
    OR private.has_role(auth.uid(),'admin'::app_role)
  );
