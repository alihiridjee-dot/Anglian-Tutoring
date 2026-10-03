-- Rollback for 20261001121207_welcome_tour_seen.sql. Everyone sees the tour again.
begin;
revoke update (welcome_tour_seen_at) on public.profiles from authenticated;
alter table public.profiles drop column if exists welcome_tour_seen_at;
commit;
