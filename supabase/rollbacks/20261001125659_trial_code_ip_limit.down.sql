-- Rollback for 20261001125659_trial_code_ip_limit.sql. Redeploy the trial-code
-- function from before it first: the current one claims through this function
-- and answers 500 without it.
drop function if exists public.claim_trial_code_request(text, integer);
drop table if exists public.trial_code_requests;
