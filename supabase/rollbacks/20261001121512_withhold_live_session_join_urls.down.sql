-- Rollback for 20261001121512_withhold_live_session_join_urls.sql. Gives
-- browsers the join_url column back, which reopens S-20.
grant select on public.resources to authenticated;
grant select on public.resources to anon;
