-- A tab's own draft edits are ordered by its own clock.
--
-- sync_homework_draft converts every stamp to the server's time with the
-- difference between the server's clock and the page's (_client_now), measured
-- on that request. The difference includes how long the request took to
-- arrive, so on a patchy connection two syncs from the same tab carry
-- different offsets. When an earlier sync crawled and a later one flew, the
-- later (newer) edit could look older than the earlier one: the server kept
-- the older words and sent them back, and the box jumped back to them.
--
-- Now the page names itself (a random id per open page, sent inside _stamps
-- under "device"), and the draft keeps, for each field, which page wrote it
-- and that page's own stamp (`origins`). An edit from the page that wrote the
-- stored value is compared on that page's own clock, with no conversion, and
-- that field goes back to it on its own clock too. Edits between different
-- devices are compared as before.
--
-- The id travels inside _stamps because the function already skips anything
-- there that isn't a number: an app built before this change keeps working
-- with the new function, and the new app keeps working with the old one. A
-- write from a page that sends no id clears the field's origin, so a stale
-- stamp is never compared against it.
--
-- Additive and idempotent. The body is the live one (20261001202000) with the
-- origin checks added.

alter table public.homework_drafts
  add column if not exists origins jsonb not null default '{}'::jsonb;

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
  _origins_out jsonb;
  _legacy double precision;
  _key text;
  _raw double precision;
  _at double precision;
  _current double precision;
  _newer boolean;
  _device text;
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
  -- The page sending this, if it says (see the header).
  _device := case
    when jsonb_typeof(coalesce(_stamps, '{}'::jsonb)) = 'object'
      and jsonb_typeof(_stamps -> 'device') = 'string'
      then nullif(_stamps ->> 'device', '')
  end;

  select * into _row
  from public.homework_drafts d
  where d.student_id = _uid and d.resource_id = _resource_id
  for update;
  _found := found;

  _answers_out := coalesce(_row.answers, '{}'::jsonb);
  _notes_out := _row.notes;
  _stamps_out := coalesce(_row.stamps, '{}'::jsonb);
  _origins_out := coalesce(_row.origins, '{}'::jsonb);
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

      _raw := (_stamps ->> _key)::double precision;
      _at := _raw + _offset;
      _current := coalesce(
        (_stamps_out ->> _key)::double precision,
        case
          when _key = 'notes' and _notes_out is not null then _legacy
          when _key <> 'notes' and _answers_out ? _key then _legacy
        end,
        '-infinity'::double precision
      );

      -- The same page wrote what is stored: its own clock decides.
      if _device is not null
        and _origins_out -> _key ->> 'device' = _device
        and jsonb_typeof(_origins_out -> _key -> 'at') = 'number'
      then
        _newer := _raw > (_origins_out -> _key ->> 'at')::double precision;
      else
        _newer := _at > _current;
      end if;

      if _newer then
        if _key = 'notes' then
          _notes_out := _notes;
        else
          _answers_out := _answers_out || jsonb_build_object(_key, _answers -> _key);
        end if;
        _stamps_out := _stamps_out || jsonb_build_object(_key, _at);
        _origins_out := case
          when _device is null then _origins_out - _key
          else _origins_out || jsonb_build_object(
            _key, jsonb_build_object('device', _device, 'at', _raw)
          )
        end;
        _changed := true;
      end if;
    end loop;
  end if;

  if _changed then
    insert into public.homework_drafts (student_id, resource_id, answers, notes, stamps, origins)
    values (_uid, _resource_id, _answers_out, _notes_out, _stamps_out, _origins_out)
    on conflict (student_id, resource_id) do update
      set answers = excluded.answers,
          notes = excluded.notes,
          stamps = excluded.stamps,
          origins = excluded.origins;
  elsif not _found then
    return null;
  end if;

  -- Back on the caller's clock: its own fields exactly as it stamped them, the
  -- rest converted. Unstamped (older) fields get their row's time.
  return jsonb_build_object(
    'answers', _answers_out,
    'notes', coalesce(_notes_out, ''),
    'stamps', (
      select coalesce(
        jsonb_object_agg(
          k,
          case
            when _device is not null
              and _origins_out -> k ->> 'device' = _device
              and jsonb_typeof(_origins_out -> k -> 'at') = 'number'
              then (_origins_out -> k ->> 'at')::double precision
            else (_stamps_out ->> k)::double precision - _offset
          end
        ),
        '{}'::jsonb
      )
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
