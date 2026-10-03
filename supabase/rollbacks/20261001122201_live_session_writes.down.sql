-- Rollback for 20261001122201_live_session_writes.sql. Roll back the app first:
-- the forms create sessions and videos through this function. Dropping the
-- column forgets which Zoom meetings the app made, so afterwards none is
-- cancelled when its session is deleted.
drop function if exists public.create_linked_resource(
  public.resource_kind, text, text, public.subject, public.level, public.board, uuid[],
  text, timestamptz, text, text
);
alter table public.resources drop column if exists zoom_meeting_id;
