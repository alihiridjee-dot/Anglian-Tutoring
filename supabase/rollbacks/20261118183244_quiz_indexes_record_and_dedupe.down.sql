-- Rollback for 20261118183244_quiz_indexes_record_and_dedupe: brings back the
-- duplicate (user_id, set_id) index on mcq_attempts, as production had it
-- (pg_get_indexdef, read 18 Nov 2026). The three recorded indexes stay: they
-- were in production before this migration.
create index if not exists idx_mcq_attempts_user
  on public.mcq_attempts using btree (user_id, set_id);
