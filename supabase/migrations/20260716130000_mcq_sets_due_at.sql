-- Assigned weekly MCQ sets carry a due date. A non-null due_at marks a set as a
-- tutor-assigned weekly quiz (shown in the student "This week's MCQs" banner and
-- aged out a week past the due date), distinguishing it from drafts and topical
-- assessments which leave due_at null.
ALTER TABLE public.mcq_sets ADD COLUMN IF NOT EXISTS due_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_mcq_sets_due_at ON public.mcq_sets(due_at);
