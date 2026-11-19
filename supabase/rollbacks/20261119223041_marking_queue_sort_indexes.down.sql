-- Rollback for 20261119223041_marking_queue_sort_indexes: drops the two
-- marking-queue indexes it made. Nothing else on the table changes.
drop index if exists public.homework_submissions_pending_idx;
drop index if exists public.homework_submissions_graded_idx;
