-- S-37 and M-2: how live sessions and videos are written.
--
-- S-37. Deleting a session asked Zoom to delete the meeting behind any link
-- containing "zoom". A tutor who pastes one recurring meeting into every weekly
-- session and then tidies an old one deleted the whole series, and every other
-- session's link died. The zoom-meeting function now cancels only a meeting
-- this app created, recorded here when "Auto Zoom" makes it, and never while
-- another session still points at it.
--
-- The column holds a meeting number, not a link: nobody but the edge function
-- (service role) needs to read it. Once
-- 20261001121512_withhold_live_session_join_urls.sql is applied, browsers can't
-- read it either, because that migration re-grants SELECT column by column.
alter table public.resources add column if not exists zoom_meeting_id text;

comment on column public.resources.zoom_meeting_id is
  'The Zoom meeting the app created for this live session, if it did. Null for a pasted link. Only such a meeting is cancelled when the session is deleted.';

-- M-2. The live-session and video forms inserted the resource, then its
-- spec-point links, as two requests. If the second failed, the session stayed
-- live with no points, and a retry made a duplicate. This writes both in one
-- transaction. Security invoker: row-level security still decides who may
-- write (tutors only), exactly as for the two inserts it replaces.
create or replace function public.create_linked_resource(
  _kind public.resource_kind,
  _title text,
  _description text,
  _subject public.subject,
  _level public.level,
  _board public.board,
  _spec_point_ids uuid[],
  _video_url text default null,
  _starts_at timestamptz default null,
  _join_url text default null,
  _zoom_meeting_id text default null
)
 returns uuid
 language plpgsql
 security invoker
 set search_path to ''
as $function$
declare
  _id uuid;
begin
  if _kind not in ('live_session'::public.resource_kind, 'video'::public.resource_kind) then
    raise exception 'Only live sessions and videos are created here';
  end if;

  insert into public.resources(
    kind, title, description, subject, level, board,
    video_url, starts_at, join_url, zoom_meeting_id, created_by
  )
  values (
    _kind, _title, _description, _subject, _level, _board,
    _video_url, _starts_at, _join_url,
    case when _kind = 'live_session'::public.resource_kind then _zoom_meeting_id end,
    (select auth.uid())
  )
  returning id into _id;

  insert into public.resource_spec_points(resource_id, spec_point_id)
  select distinct _id, p from unnest(coalesce(_spec_point_ids, '{}'::uuid[])) as p;

  return _id;
end;
$function$;

revoke all on function public.create_linked_resource(
  public.resource_kind, text, text, public.subject, public.level, public.board, uuid[],
  text, timestamptz, text, text
) from public;
revoke all on function public.create_linked_resource(
  public.resource_kind, text, text, public.subject, public.level, public.board, uuid[],
  text, timestamptz, text, text
) from anon;
grant execute on function public.create_linked_resource(
  public.resource_kind, text, text, public.subject, public.level, public.board, uuid[],
  text, timestamptz, text, text
) to authenticated;
