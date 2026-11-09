-- Rollback for 20261109170711_student_practice_requests: students can no longer
-- ask for a point's quiz and task. Jobs they already queued stay queued and are
-- written as usual; their ai_request_log rows are pruned within a day.
drop function if exists public.request_practice_for_point(uuid);
drop function if exists public.practice_for_point(uuid);
drop function if exists private.practice_state(uuid, text);
drop function if exists private.can_request_practice(uuid, uuid);
drop function if exists private.practice_requests_used_today(uuid);
drop function if exists private.practice_request_daily_limit();
