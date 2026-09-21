-- A paper without a tier is still one paper.
--
-- The exemplar key includes tier, and OCR, Cambridge and OxfordAQA papers
-- have none. Postgres treats every null as different from every other, so a
-- row with no tier never matched itself: re-loading such a paper inserted a
-- second copy of every question instead of correcting the first, and the
-- loader's upsert could never update one in place. NULLS NOT DISTINCT makes a
-- missing tier compare equal to another missing tier, which is what the key
-- always meant.
--
-- DOWN: supabase/rollbacks/20260921132508_exam_exemplar_untiered_key.down.sql

alter table public.exam_exemplars
  drop constraint exam_exemplars_paper_question_key,
  add constraint exam_exemplars_paper_question_key
    unique nulls not distinct (board, subject, level, year, series, paper, tier, question_label);
