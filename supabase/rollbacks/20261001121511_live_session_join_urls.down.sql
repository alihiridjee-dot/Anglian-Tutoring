-- Rollback for 20261001121511_live_session_join_urls.sql. Roll back
-- 20261001121512 first if it is applied: the app reads links only through this
-- function once the column is withheld.
drop function if exists public.live_session_join_urls(uuid[]);
