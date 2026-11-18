-- M10: the quiz tables' indexes, as production has them.
--
-- (b) Record. Production already has three indexes that no migration made
-- (created through the dashboard). Each is copied from the live
-- pg_get_indexdef (read 18 Nov 2026) under its live name, so a database built
-- from the repo matches production and applying this there changes nothing.
--   * mcq_questions by set: a quiz's questions (TakeMcqPage, McqsPage's counts).
--   * mcq_questions by spec point: a point's quizzes (curriculum, the week's
--     activity in the planner).
--   * mcq_attempts by set: attempts read for a set of quizzes (SpecPointDetail).
create index if not exists idx_mcq_questions_set_id
  on public.mcq_questions using btree (set_id);
create index if not exists idx_mcq_questions_spec_point_id
  on public.mcq_questions using btree (spec_point_id);
create index if not exists idx_mcq_attempts_set_id
  on public.mcq_attempts using btree (set_id);

-- (a) Dedupe. mcq_attempts has (user_id, set_id) twice: idx_mcq_attempts_user
-- (20260706092211) and mcq_attempts_user_set_idx (20260806170000). Neither
-- backs a constraint. Keep the later one; every attempt write was paying for
-- both.
drop index if exists public.idx_mcq_attempts_user;
