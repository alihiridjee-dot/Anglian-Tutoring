-- Foreign keys the advisor flagged as uncovered. Each is on a path a student
-- hits routinely, and an unindexed FK means a sequential scan per lookup --
-- cheap on a demo dataset, and the first thing to fall over once a cohort's
-- worth of rows accumulates behind it.

-- The marking queue joins answers back to their question, and the student's
-- answered view looks up marks per question.
create index if not exists homework_answers_question_id_idx
  on public.homework_answers (question_id);

-- Chat renders sender names per message; the unread badge polls every 20s per
-- signed-in user, so this one is read constantly.
create index if not exists chat_messages_sender_id_idx
  on public.chat_messages (sender_id);

-- Threads pinned to a spec point / homework / quiz are looked up by that pin
-- when opening the related surface.
create index if not exists chat_threads_spec_point_id_idx
  on public.chat_threads (spec_point_id) where spec_point_id is not null;
create index if not exists chat_threads_resource_id_idx
  on public.chat_threads (resource_id) where resource_id is not null;
create index if not exists chat_threads_mcq_set_id_idx
  on public.chat_threads (mcq_set_id) where mcq_set_id is not null;

-- billing_feedback is read per user on the billing page.
create index if not exists billing_feedback_user_id_idx
  on public.billing_feedback (user_id);

-- The planner's coverage and FSRS sync both filter attempts by student, and the
-- weekly check reads them by set. Composite because both columns are always
-- used together.
create index if not exists mcq_attempts_user_set_idx
  on public.mcq_attempts (user_id, set_id);

-- Same shape for homework: coverage reads a student's submissions for a set of
-- resources on every planner load.
create index if not exists homework_submissions_student_resource_idx
  on public.homework_submissions (student_id, resource_id);

-- `revoke ... from public` does not cover `anon`: Supabase's default privileges
-- grant EXECUTE on every new function to anon, authenticated and service_role
-- explicitly, so the PUBLIC revoke leaves the anon grant in place.
--
-- Each of these already refuses a caller with no auth.uid(), so this closes a
-- reachable-but-useless endpoint rather than a hole. It should still be shut:
-- an unauthenticated request has no business reaching a SECURITY DEFINER body
-- at all, and `prune_ai_request_log` in particular is housekeeping that no
-- client should be able to trigger.
revoke execute on function public.claim_ai_request(text, int, interval) from anon;
revoke execute on function public.grade_mcq_attempt(uuid, jsonb) from anon;
revoke execute on function public.prune_ai_request_log() from anon;
revoke execute on function public.save_student_enrolments(jsonb) from anon;
revoke execute on function public.save_weekly_plan(uuid, subject, board, level, date, plan_source, text, jsonb) from anon;

-- Housekeeping is an operator action, not an API surface.
revoke execute on function public.prune_ai_request_log() from authenticated;
