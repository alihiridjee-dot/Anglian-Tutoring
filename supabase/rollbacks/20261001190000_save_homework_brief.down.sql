-- Rollback for 20261001190000_save_homework_brief.sql. Roll the app back
-- first: HomeworkForm calls this function, and without it no brief can be
-- created or saved.
drop function if exists public.save_homework_brief(
  uuid, text, text, timestamptz, public.subject, public.board, public.level, uuid[], jsonb
);
