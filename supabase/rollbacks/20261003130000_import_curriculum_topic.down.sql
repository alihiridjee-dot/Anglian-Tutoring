-- Rollback for 20261003130000_import_curriculum_topic.sql. Roll the app back
-- first: the Curriculum Sync panel calls this function, and without it no
-- pasted curriculum can be imported. Topics and spec points it wrote stay.
drop function if exists public.import_curriculum_topic(
  public.subject, public.board, public.level, text, text, text, jsonb
);
