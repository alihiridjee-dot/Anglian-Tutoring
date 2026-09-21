-- Which sitting a paper belongs to.
--
-- An exemplar was identified by board, subject, level, year, paper, tier and
-- question label. That names one paper for the GCSE sciences, which sit once a
-- year, but not for the international boards: Edexcel iGCSE sets the same
-- paper number in January and June, and Cambridge in March, June and November.
-- Two sittings of one paper shared an identity, so loading the second would
-- have overwritten the first, question by question, with a different paper.
--
-- series names the sitting the way the boards group them:
--
--   jan  January
--   mar  February/March
--   jun  May/June — the summer series, whichever month the paper was sat in
--   nov  October/November — the autumn series
--
-- It is required. A paper whose sitting nobody has checked is refused at load,
-- rather than filed where a later sitting would land on top of it.
--
-- DOWN: supabase/rollbacks/20260921121332_exam_exemplar_series.down.sql

alter table public.exam_exemplars
  add column series text check (series in ('jan', 'mar', 'jun', 'nov'));

comment on column public.exam_exemplars.series is
  'The sitting the paper belongs to: jan, mar (February/March), jun (May/June) or nov '
  '(October/November). Part of the paper''s identity, because the international boards '
  'set the same paper number in more than one sitting a year.';

-- The papers already loaded, each checked against the date printed on it.
--
-- GCSE sciences sit only in the summer, and every GCSE paper here says May or
-- June. Two Edexcel iGCSE Chemistry papers were sat in November: 2021, and
-- 2020, whose May paper was cancelled and sat in the November series instead
-- (the paper says 14 May 2020; its mark scheme, November 2020).
update public.exam_exemplars
set series = 'nov'
where board = 'edexcel' and subject = 'chemistry' and level = 'igcse'
  and year in ('2020', '2021') and paper = '1' and tier = 'C';

update public.exam_exemplars
set series = 'jun'
where series is null
  and (level = 'gcse'
       or (board = 'edexcel' and subject = 'chemistry' and level = 'igcse'
           and year = '2022' and paper = '1' and tier = 'C'));

-- Anything else was loaded after these were checked, so its sitting is unknown
-- here. Guessing would file it under the wrong paper; stop instead.
do $$
begin
  if exists (select 1 from public.exam_exemplars where series is null) then
    raise exception 'Exemplars with an unchecked sitting: set series on them by hand, then re-run';
  end if;
end
$$;

alter table public.exam_exemplars alter column series set not null;

alter table public.exam_exemplars
  drop constraint exam_exemplars_board_subject_level_year_paper_tier_question_key,
  add constraint exam_exemplars_paper_question_key
    unique (board, subject, level, year, series, paper, tier, question_label);
