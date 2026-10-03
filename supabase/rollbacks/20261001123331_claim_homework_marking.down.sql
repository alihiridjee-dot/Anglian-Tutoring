-- Rollback for 20261001123331_claim_homework_marking.sql. Redeploy the
-- mark-homework from before it first: the current one claims through this
-- function and refuses to mark without it.
drop function if exists public.claim_homework_marking(uuid);
alter table public.homework_submissions drop column if exists ai_marking_started_at;
