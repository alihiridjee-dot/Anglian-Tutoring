-- A sample paper's sitting.
--
-- Boards publish sample (specimen) papers before a specification is first
-- examined. They are written by the same examiners to the same specification,
-- so their questions are as good a model as any sat paper's, but they were
-- never sat: no sitting, and no year. series only allowed the four real
-- sittings, so a sample paper could not be filed without inventing one, and an
-- invented June could land on top of a real June paper with the same number.
--
--   sample  a sample or specimen paper; its year is null
--
-- Only widens the check: every row already loaded stays valid.
--
-- DOWN: supabase/rollbacks/20261001104009_exam_exemplar_sample_series.down.sql

alter table public.exam_exemplars
  drop constraint exam_exemplars_series_check,
  add constraint exam_exemplars_series_check
    check (series in ('jan', 'mar', 'jun', 'nov', 'sample'));

comment on column public.exam_exemplars.series is
  'The sitting the paper belongs to: jan, mar (February/March), jun (May/June) or nov '
  '(October/November), or sample for a sample/specimen paper that was never sat. Part of '
  'the paper''s identity, because the international boards set the same paper number in '
  'more than one sitting a year.';
