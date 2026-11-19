-- L27: the marking queue's two sorts get an index each.
--
-- MarkingQueue reads one page at a time: "To review" is every submission with
-- no mark yet, newest hand-in first (graded_at is null, order by submitted_at
-- desc); "Marked" is every marked one, latest mark first (graded_at is not
-- null, order by graded_at desc). Production's indexes on this table (read 19
-- Nov 2026 from pg_get_indexdef) are the primary key, the (resource_id,
-- student_id) unique key, (student_id, resource_id), (student_id),
-- (resource_id) and the timer's (release_at) where unmarked: none serves
-- either sort, so each page sorted the whole segment first.
--
-- Each index is partial on the segment it serves, in the order the page reads
-- it. submitted_at is not null, so the first needs no nulls clause; the second
-- holds no nulls at all.
create index if not exists homework_submissions_pending_idx
  on public.homework_submissions (submitted_at desc)
  where graded_at is null;
create index if not exists homework_submissions_graded_idx
  on public.homework_submissions (graded_at desc)
  where graded_at is not null;
