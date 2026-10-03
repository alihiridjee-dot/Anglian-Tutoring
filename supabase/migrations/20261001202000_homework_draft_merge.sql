-- S-16: homework drafts merge per question, so one device can't wipe another's.
--
-- A draft was one whole object, and the newest whole object won, timed by the
-- writing device's clock. A laptop tab opened yesterday wrote its whole state
-- on its next keystroke, blanking the answers typed on the phone since; a
-- laptop that had been offline did the same when it reconnected.
--
-- Now each answer (and the note) carries the time it was last edited, in
-- `stamps`, and sync_homework_draft keeps the newer edit field by field. A tab
-- that never touched question 2 can't overwrite it, and an edit made offline
-- still beats an older one when it finally arrives.
--
-- Device clocks disagree, so stamps are kept in the server's time. The page
-- sends its own clock reading (_client_now) with each call. The difference
-- between that and the server's clock converts the page's stamps on the way
-- in, and the stored ones back on the way out, so the page only ever compares
-- times on its own clock. A wrong device clock then shifts both sides equally.
--
-- updated_at is set by the server too (a trigger), for every writer, so the
-- 30-day sweep (sweep_stale_homework_drafts) goes by when a draft was really
-- last written.
--
-- SECURITY INVOKER: the draft is the caller's own row, and the "hd own" policy
-- already says so. Once the homework is handed in, the draft is finished with:
-- the function writes nothing and returns null, so an old tab can't bring a
-- submitted homework's draft back.
--
-- Additive and idempotent; safe in either order with the app. The app now live
-- writes the table directly and ignores `stamps`; its rows read as stamped at
-- their updated_at.

alter table public.homework_drafts
  add column if not exists stamps jsonb not null default '{}'::jsonb;

create or replace function public.stamp_homework_draft()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists stamp_homework_draft on public.homework_drafts;
create trigger stamp_homework_draft
  before insert or update on public.homework_drafts
  for each row execute function public.stamp_homework_draft();

create or replace function public.sync_homework_draft(
  _resource_id uuid,
  _answers jsonb default '{}'::jsonb,
  _notes text default null,
  _stamps jsonb default '{}'::jsonb,
  _client_now double precision default null
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  _uid uuid := (select auth.uid());
  -- Milliseconds since the epoch, like the page's Date.now().
  _now double precision := extract(epoch from clock_timestamp()) * 1000;
  _offset double precision;
  _row public.homework_drafts%rowtype;
  _found boolean;
  _answers_out jsonb;
  _notes_out text;
  _stamps_out jsonb;
  _legacy double precision;
  _key text;
  _at double precision;
  _current double precision;
  _changed boolean := false;
begin
  if _uid is null then
    raise exception 'Not signed in';
  end if;

  if exists (
    select 1 from public.homework_submissions s
    where s.resource_id = _resource_id and s.student_id = _uid
  ) then
    return null;
  end if;

  _offset := case when _client_now is null then 0 else _now - _client_now end;

  select * into _row
  from public.homework_drafts d
  where d.student_id = _uid and d.resource_id = _resource_id
  for update;
  _found := found;

  _answers_out := coalesce(_row.answers, '{}'::jsonb);
  _notes_out := _row.notes;
  _stamps_out := coalesce(_row.stamps, '{}'::jsonb);
  -- A field written without a stamp (by the app before this change) counts as
  -- written when its row last was.
  _legacy := extract(epoch from _row.updated_at) * 1000;

  if jsonb_typeof(coalesce(_stamps, '{}'::jsonb)) = 'object' then
    for _key in select jsonb_object_keys(coalesce(_stamps, '{}'::jsonb)) loop
      if jsonb_typeof(_stamps -> _key) <> 'number' then
        continue;
      end if;
      -- Only fields actually sent: an answer as a string, the note as _notes.
      if _key = 'notes' then
        if _notes is null then continue; end if;
      elsif jsonb_typeof(coalesce(_answers, '{}'::jsonb) -> _key) is distinct from 'string' then
        continue;
      end if;

      _at := (_stamps ->> _key)::double precision + _offset;
      _current := coalesce(
        (_stamps_out ->> _key)::double precision,
        case
          when _key = 'notes' and _notes_out is not null then _legacy
          when _key <> 'notes' and _answers_out ? _key then _legacy
        end,
        '-infinity'::double precision
      );

      if _at > _current then
        if _key = 'notes' then
          _notes_out := _notes;
        else
          _answers_out := _answers_out || jsonb_build_object(_key, _answers -> _key);
        end if;
        _stamps_out := _stamps_out || jsonb_build_object(_key, _at);
        _changed := true;
      end if;
    end loop;
  end if;

  if _changed then
    insert into public.homework_drafts (student_id, resource_id, answers, notes, stamps)
    values (_uid, _resource_id, _answers_out, _notes_out, _stamps_out)
    on conflict (student_id, resource_id) do update
      set answers = excluded.answers, notes = excluded.notes, stamps = excluded.stamps;
  elsif not _found then
    return null;
  end if;

  -- Back on the caller's clock. Unstamped (older) fields get their row's time.
  return jsonb_build_object(
    'answers', _answers_out,
    'notes', coalesce(_notes_out, ''),
    'stamps', (
      select coalesce(jsonb_object_agg(k, (_stamps_out ->> k)::double precision - _offset), '{}'::jsonb)
      from jsonb_object_keys(_stamps_out) k
    ) || (
      select coalesce(jsonb_object_agg(k, coalesce(_legacy, _now) - _offset), '{}'::jsonb)
      from (
        select jsonb_object_keys(_answers_out) k
        union all
        select 'notes' where _notes_out is not null
      ) f
      where not _stamps_out ? f.k
    )
  );
end;
$function$;

revoke all on function public.sync_homework_draft(uuid, jsonb, text, jsonb, double precision) from public, anon;
grant execute on function public.sync_homework_draft(uuid, jsonb, text, jsonb, double precision) to authenticated, service_role;
