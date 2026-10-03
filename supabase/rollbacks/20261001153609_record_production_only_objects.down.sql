-- Rollback for 20261001153609_record_production_only_objects.sql: deliberately
-- nothing. That migration records objects production already had and changes
-- nothing there; dropping them would delete live notifications, spec-point
-- links and the acknowledge flow. Removing the file from the repo is the whole
-- of undoing it.
select 1;
