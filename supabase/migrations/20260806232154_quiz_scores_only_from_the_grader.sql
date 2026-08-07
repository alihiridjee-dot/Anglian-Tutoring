-- A quiz score has to be something the platform worked out, not something the
-- student sent.
--
-- `grade_mcq_attempt` was added so marking happens server-side against the
-- stored `correct_index`, and the client was moved onto it. What was left
-- behind is the door it replaced: the "attempts self insert" policy
-- (`auth.uid() = user_id`) plus INSERT/UPDATE column grants on every column of
-- `mcq_attempts`, including `score` and `total`. Nothing checks that the score
-- was ever earned, so one request to
--
--   POST /rest/v1/mcq_attempts  {"set_id": …, "user_id": me, "score": 20, "total": 20}
--
-- writes a perfect paper. And an mcq_attempt is not a vanity number: it feeds
-- the predicted grade a parent is shown, the FSRS review ledger that decides
-- when a topic comes back, and the tutor's read on who is struggling. A student
-- who inflates it quietly removes their own weak topics from the schedule —
-- which is the one thing the whole product exists to prevent.
--
-- UPDATE was worse still: no policy ever granted it, but the column privileges
-- were there, so the only thing standing between a student and rewriting last
-- month's marks was the absence of a policy.
--
-- `grade_mcq_attempt` is SECURITY DEFINER, so it keeps writing attempts after
-- the caller's own privileges are gone. Reads are untouched: a student still
-- sees their own attempts, a parent their child's, a tutor everyone's.

drop policy if exists "attempts self insert" on public.mcq_attempts;

revoke insert, update on public.mcq_attempts from authenticated, anon;

-- The grader is the only writer now, so it must stay callable — and stay
-- callable only by someone signed in, since it reads the answer key.
revoke all on function public.grade_mcq_attempt(uuid, jsonb) from public, anon;
grant execute on function public.grade_mcq_attempt(uuid, jsonb) to authenticated;
