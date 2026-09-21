-- DOWN for migrations/20260921132508_exam_exemplar_untiered_key.sql.
--
-- Kept out of supabase/migrations on purpose: the CLI applies everything in
-- that folder, in order, and a rollback must only ever run by hand.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -f supabase/rollbacks/20260921132508_exam_exemplar_untiered_key.down.sql
--
-- The plain key is looser than the one it replaces, so this always succeeds —
-- and re-loading an untiered paper afterwards will duplicate it again.

begin;

alter table public.exam_exemplars
  drop constraint exam_exemplars_paper_question_key,
  add constraint exam_exemplars_paper_question_key
    unique (board, subject, level, year, series, paper, tier, question_label);

notify pgrst, 'reload schema';

commit;
