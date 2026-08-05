-- A snapshot of what the thread is about, written when it is created.
--
-- The FK columns are the link (open the spec point, jump to the homework); this
-- is the label. Denormalised on purpose: the linked row may be behind the
-- paywall for a lapsed student, or renamed, or deleted, and a conversation that
-- suddenly can't say what it was about is worse than a slightly stale title.
alter table public.chat_threads add column if not exists context_label text;
