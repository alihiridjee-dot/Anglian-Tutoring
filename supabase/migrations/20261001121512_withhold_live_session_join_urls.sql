-- S-20, second step: withdraw resources.join_url from browser reads.
--
-- Apply only after the app that reads join links through
-- live_session_join_urls() (20261001121511_live_session_join_urls.sql) is
-- live. The app before it selects this column directly and would be refused.
--
-- Revoking one column is a no-op while a table-wide SELECT grant exists, so
-- drop the table grant (which also drops any per-column SELECT grants) and
-- re-grant every other column. INSERT, UPDATE and DELETE stay granted (RLS
-- still limits them to tutors), so tutors keep writing join_url. The edge
-- functions read with the service role and are unaffected.
--
-- A column added to resources after this needs its own `grant select (…)` to
-- be readable from the app.
revoke select on public.resources from authenticated;
revoke select on public.resources from anon;
grant select (
  id, kind, title, description, subject, board, level, video_url, duration_seconds,
  file_path, file_name, file_mime, file_size, mark_scheme_path, mark_scheme_name,
  starts_at, due_at, instructions, created_by, created_at, spec_point_id, origin,
  review_status, publish_at, reviewed_by, reviewed_at
) on public.resources to authenticated;
