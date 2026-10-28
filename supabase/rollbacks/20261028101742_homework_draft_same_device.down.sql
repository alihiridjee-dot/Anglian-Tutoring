-- Rollback for 20261028101742_homework_draft_same_device.sql. Run by hand.
--
-- Puts sync_homework_draft back as 20261001202000 left it, which is the body
-- live on 28 Oct 2026 (read with pg_get_functiondef, md5 682559e6...): every
-- stamp is converted with its own request's clock difference, and the page's
-- id, still sent by the app, is skipped as it isn't a number. Then drops the
-- origins column and its size cap, which nothing else reads.

create or replace function public.sync_homework_draft(
  _resource_id uuid,
  _answers jsonb default '{}'::jsonb,
  _notes text default null::text,
  _stamps jsonb default '{}'::jsonb,
  _client_now double precision default null::double precision
)
 returns jsonb
 language plpgsql
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

alter table public.homework_drafts drop constraint if exists homework_drafts_origins_size;
alter table public.homework_drafts drop column if exists origins;
