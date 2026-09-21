-- DOWN for migrations/20260921121332_exam_exemplar_series.sql.
--
-- Kept out of supabase/migrations on purpose: the CLI applies everything in
-- that folder, in order, and a rollback must only ever run by hand.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -f supabase/rollbacks/20260921121332_exam_exemplar_series.down.sql
--
-- Without series, two sittings of one paper are the same paper. If both have
-- been loaded, the old key cannot hold them and one would have to go, which is
-- a decision about content rather than schema, so this refuses until only one
-- sitting of each paper is left.
--
-- One transaction: any failure leaves the schema exactly as it was.

begin;

do $$
begin
  if exists (
    select 1 from public.exam_exemplars
    group by board, subject, level, year, paper, tier, question_label
    having count(distinct series) > 1
  ) then
    raise exception 'More than one sitting of a paper is loaded: remove all but one, then re-run';
  end if;
end
$$;

alter table public.exam_exemplars
  drop constraint exam_exemplars_paper_question_key,
  add constraint exam_exemplars_board_subject_level_year_paper_tier_question_key
    unique (board, subject, level, year, paper, tier, question_label);

alter table public.exam_exemplars drop column series;

notify pgrst, 'reload schema';

commit;
