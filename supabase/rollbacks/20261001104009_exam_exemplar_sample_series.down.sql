-- DOWN for migrations/20261001104009_exam_exemplar_sample_series.sql.
--
-- Kept out of supabase/migrations on purpose: the CLI applies everything in
-- that folder, in order, and a rollback must only ever run by hand.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -f supabase/rollbacks/20261001104009_exam_exemplar_sample_series.down.sql
--
-- A sample paper has no other sitting to move to, so removing it is a decision
-- about content rather than schema: this refuses while any are loaded.
--
-- One transaction: any failure leaves the schema exactly as it was.

begin;

do $$
begin
  if exists (select 1 from public.exam_exemplars where series = 'sample') then
    raise exception 'Sample papers are loaded: remove them, then re-run';
  end if;
end
$$;

alter table public.exam_exemplars
  drop constraint exam_exemplars_series_check,
  add constraint exam_exemplars_series_check
    check (series in ('jan', 'mar', 'jun', 'nov'));

comment on column public.exam_exemplars.series is
  'The sitting the paper belongs to: jan, mar (February/March), jun (May/June) or nov '
  '(October/November). Part of the paper''s identity, because the international boards '
  'set the same paper number in more than one sitting a year.';

commit;
