-- Rollback for 20261003090000_chat_thread_summaries.sql. Run by hand.
-- Revert the app change first: listThreads calls this function.
drop function if exists public.chat_thread_summaries(uuid[]);
