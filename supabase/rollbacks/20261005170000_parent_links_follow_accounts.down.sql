-- Rollback for 20261005170000_parent_links_follow_accounts.sql. Run by hand.
--
-- Drops the two foreign keys, so a link outlives a deleted account again. The
-- links the migration deleted are not brought back: each named an account that
-- no longer exists.
alter table public.parent_student_links drop constraint if exists parent_student_links_parent_id_fkey;
alter table public.parent_student_links drop constraint if exists parent_student_links_student_id_fkey;
