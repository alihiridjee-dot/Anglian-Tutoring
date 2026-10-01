-- Rollback for 20261001111025_withhold_homework_mark_schemes.sql. Gives
-- browsers the mark_scheme column back, which reopens finding #10.
grant select on public.homework_questions to authenticated;
grant select on public.homework_questions to anon;
