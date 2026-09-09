-- The file era, closed out.
--
-- Split from `20260909120000_homework_on_platform.sql` on purpose: everything in
-- that migration is additive and can land while the old code is still running,
-- but these drops cannot be undone and break any deploy still reading the
-- columns. Expand first, contract after — run this once the app that no longer
-- touches submission files is live.
--
-- Submissions were once folders of uploaded photos. They are typed answers now,
-- and these three columns have no writer left: `submit_homework_answers` stopped
-- collecting attachment metadata, and the acknowledgement sweep that deleted the
-- bytes went with it.
--
-- `resources.file_path` and `mark_scheme_path` deliberately survive: the
-- "resources bucket read scoped" storage policy is defined in terms of them, and
-- dropping the columns would mean rewriting a policy that still governs every
-- tutor-uploaded file in the bucket. Nothing costs us by their staying.

alter table public.homework_submissions
  drop column if exists files,
  drop column if exists files_deleted_at;

alter table public.homework_answers
  drop column if exists images;

-- `mark_submission_files_deleted` recorded a sweep of bytes that no longer
-- exist, and its column is gone.
drop function if exists public.mark_submission_files_deleted(uuid);
