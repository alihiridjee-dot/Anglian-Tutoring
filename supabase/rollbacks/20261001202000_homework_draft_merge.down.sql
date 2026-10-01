-- Rollback for 20261001202000_homework_draft_merge.sql. Roll the app back
-- first: the new page saves drafts only through sync_homework_draft. Drafts
-- keep their answers and notes; only the per-question times go.
begin;

drop function if exists public.sync_homework_draft(uuid, jsonb, text, jsonb, double precision);
drop trigger if exists stamp_homework_draft on public.homework_drafts;
drop function if exists public.stamp_homework_draft();
alter table public.homework_drafts drop column if exists stamps;

commit;
