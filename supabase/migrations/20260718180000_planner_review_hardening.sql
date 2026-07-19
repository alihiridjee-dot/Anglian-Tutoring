-- Security hardening for the planner's FSRS review ledger + weekly check-ins.
--
-- 1 · student_weekly_checkins "wc own" only checked auth.uid() = student_id, so
--     any student could INSERT a check-in row against ANOTHER student's plan_id
--     (with their own student_id). Because plan_id is unique, that both injects
--     a fake reflection into the tutor's view of that week and permanently
--     blocks the real student from saving theirs. The write path must prove the
--     plan belongs to the caller.
--
-- 2 · student_spec_point_reviews is documented as an append-only ledger, but
--     both FOR ALL policies granted UPDATE/DELETE. A student could delete a bad
--     review and re-insert it (same source_id passes the dedupe again), which
--     replays the event onto the FSRS card and double-advances it — i.e. the
--     ledger stops being the source of truth. Restrict everyone to
--     SELECT + INSERT; the app never updates or deletes ledger rows.
--
-- 3 · score_pct and source were unconstrained; pin them to what the app writes.

-- ── 1 · Check-in ownership must flow through the plan ────────────────────────
drop policy if exists "wc own" on public.student_weekly_checkins;
create policy "wc own" on public.student_weekly_checkins
  for all to authenticated
  using (auth.uid() = student_id)
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from public.student_weekly_plans p
      where p.id = student_weekly_checkins.plan_id
        and p.student_id = auth.uid()
    )
  );

-- ── 2 · Review ledger: append-only for everyone ──────────────────────────────
drop policy if exists "sspr own" on public.student_spec_point_reviews;
create policy "sspr own select" on public.student_spec_point_reviews
  for select to authenticated
  using (auth.uid() = student_id);
create policy "sspr own insert" on public.student_spec_point_reviews
  for insert to authenticated
  with check (auth.uid() = student_id);

drop policy if exists "sspr tutor" on public.student_spec_point_reviews;
create policy "sspr tutor select" on public.student_spec_point_reviews
  for select to authenticated
  using (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role));
create policy "sspr tutor insert" on public.student_spec_point_reviews
  for insert to authenticated
  with check (private.has_role(auth.uid(),'tutor'::app_role) or private.has_role(auth.uid(),'admin'::app_role));

-- ── 3 · Data validity ────────────────────────────────────────────────────────
alter table public.student_spec_point_reviews
  drop constraint if exists sspr_score_pct_range,
  add constraint sspr_score_pct_range
    check (score_pct is null or (score_pct between 0 and 100));

alter table public.student_spec_point_reviews
  drop constraint if exists sspr_source_allowed,
  add constraint sspr_source_allowed
    check (source in ('homework','mcq','confidence'));

-- ── 4 · Least privilege on the exposed RPC surface ───────────────────────────
-- enforce_grading_privileges is a trigger function and purge_stale_live_sessions
-- is invoked by cron/service role — neither should be callable via /rest/v1/rpc.
-- my_access_state is used by signed-in clients only.
revoke execute on function public.enforce_grading_privileges() from anon, authenticated, public;
revoke execute on function public.purge_stale_live_sessions() from anon, authenticated, public;
revoke execute on function public.my_access_state() from anon, public;
