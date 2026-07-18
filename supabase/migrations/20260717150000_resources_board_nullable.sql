-- Live sessions become broad, exam-board-agnostic themes (per subject + level).
-- They are stored as resources rows with board = null, so board can no longer be
-- required. Homework/video/download rows keep setting board as before.
ALTER TABLE public.resources ALTER COLUMN board DROP NOT NULL;
