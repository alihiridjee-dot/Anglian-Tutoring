-- DOWN for migrations/20260921101610_cambridge_and_oxfordaqa_boards.sql.
--
-- Kept out of supabase/migrations on purpose: the CLI applies everything in
-- that folder, in order, and a rollback must only ever run by hand.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -f supabase/rollbacks/20260921101610_cambridge_and_oxfordaqa_boards.down.sql
--
-- Postgres cannot drop a value from an enum, so this rebuilds `board` without
-- cambridge and oxford_aqa — the swap 20260729191440 made for edexcel_intl.
-- Two things make that harder than it looks, and both are handled here rather
-- than left to whoever runs it:
--
--   1. Rows. A board still in use cannot be removed without losing the rows
--      that name it, so the script refuses while any exist. Move or delete them
--      first; that is a decision about students and content, not about schema.
--
--   2. Functions. Every function with a `board` argument, default or result
--      depends on the type and has to be dropped for it to go. Their bodies are
--      NOT copied into this file — a copy would restore whatever they said on
--      the day it was written. The live definitions are read from the
--      catalogue at run time and replayed, and so are their grants. Those are
--      not uniform: ensure_generated_homework is service-role only
--      (20260917120000), and a plain CREATE would hand it back to every
--      signed-in user. The script checks each function's grants afterwards and
--      aborts if any differ.
--
-- One transaction: any failure leaves the schema exactly as it was.

begin;

-- Pin name resolution, so the definitions captured below print `board` bare
-- and the replay binds it to the rebuilt type, whoever runs this.
set local search_path = public;

-- 1. Refuse while anything still uses the boards being removed. ------------------

do $$
declare
  _col record;
  _n bigint;
begin
  for _col in
    select a.attrelid::regclass as tbl, a.attname as col
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    where a.atttypid = 'public.board'::regtype
      and not a.attisdropped
      and c.relkind in ('r', 'p')
  loop
    execute format(
      'select count(*) from %s where %I::text in (''cambridge'', ''oxford_aqa'')',
      _col.tbl, _col.col
    ) into _n;
    if _n > 0 then
      raise exception
        '%.% still has % row(s) on cambridge or oxford_aqa. Move or delete them before rolling back.',
        _col.tbl, _col.col, _n;
    end if;
  end loop;
end $$;

-- 2. Capture every function that depends on the type. --------------------------
--
-- pg_depend records a function's dependency on each of its argument, default
-- and result types, so this finds them without a hand-kept list.

create temporary table _board_fns on commit drop as
select distinct on (p.oid)
  p.oid,
  format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) as signature,
  pg_get_functiondef(p.oid) as definition,
  p.proowner::regrole::text as owner,
  coalesce(p.proacl, acldefault('f', p.proowner)) as acl,
  obj_description(p.oid, 'pg_proc') as comment
from pg_depend d
join pg_proc p on p.oid = d.objid
join pg_namespace n on n.oid = p.pronamespace
where d.classid = 'pg_proc'::regclass
  and d.refclassid = 'pg_type'::regclass
  and d.refobjid in (
    'public.board'::regtype,
    (select typarray from pg_type where oid = 'public.board'::regtype)
  );

do $$
declare
  _f record;
begin
  for _f in select oid from _board_fns loop
    -- No CASCADE: if a view, policy or trigger uses one of these, stop here.
    execute format('drop function %s', _f.oid::regprocedure);
  end loop;
end $$;

-- 3. Rebuild the type without the two boards, and move every column onto it. ---

alter type public.board rename to board_retired;

do $$
declare
  _labels text;
  _col record;
begin
  select string_agg(quote_literal(enumlabel), ', ' order by enumsortorder)
  into _labels
  from pg_enum
  where enumtypid = 'public.board_retired'::regtype
    and enumlabel not in ('cambridge', 'oxford_aqa');
  execute format('create type public.board as enum (%s)', _labels);

  -- Indexes on these columns are rebuilt by ALTER COLUMN TYPE itself.
  for _col in
    select a.attrelid::regclass as tbl, a.attname as col
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    where a.atttypid = 'public.board_retired'::regtype
      and not a.attisdropped
      and c.relkind in ('r', 'p')
  loop
    execute format(
      'alter table %s alter column %I type public.board using %I::text::public.board',
      _col.tbl, _col.col, _col.col
    );
  end loop;
end $$;

-- Fails, and so rolls everything back, if anything uncaught still depends on it.
drop type public.board_retired;

-- 4. Replay the functions with their owners, grants and comments. --------------

do $$
declare
  _f record;
  _g record;
  _new regprocedure;
  _owner oid;
  _who text;
begin
  for _f in select * from _board_fns loop
    execute _f.definition;
    _new := to_regprocedure(_f.signature);
    if _new is null then
      raise exception 'Could not find % after recreating it', _f.signature;
    end if;

    select proowner into _owner from pg_proc where oid = _new;
    if _owner::regrole::text <> _f.owner then
      execute format('alter function %s owner to %s', _new, _f.owner);
      _owner := _f.owner::regrole;
    end if;

    -- Clear whatever CREATE and the schema's default privileges just granted,
    -- then grant back exactly what the function had before.
    for _g in
      select grantee, privilege_type
      from aclexplode(
        coalesce((select proacl from pg_proc where oid = _new), acldefault('f', _owner))
      )
      where grantee <> _owner
    loop
      _who := case when _g.grantee = 0 then 'public' else _g.grantee::regrole::text end;
      execute format('revoke %s on function %s from %s', _g.privilege_type, _new, _who);
    end loop;

    for _g in
      select grantee, privilege_type, is_grantable
      from aclexplode(_f.acl)
      where grantee <> _owner
    loop
      _who := case when _g.grantee = 0 then 'public' else _g.grantee::regrole::text end;
      execute format(
        'grant %s on function %s to %s%s',
        _g.privilege_type, _new, _who,
        case when _g.is_grantable then ' with grant option' else '' end
      );
    end loop;

    if _f.comment is not null then
      execute format('comment on function %s is %L', _new, _f.comment);
    end if;

    if (
      select array_agg(x::text order by x::text)
      from unnest(coalesce((select proacl from pg_proc where oid = _new), acldefault('f', _owner))) x
    ) is distinct from (
      select array_agg(x::text order by x::text) from unnest(_f.acl) x
    ) then
      raise exception 'Grants on % did not survive the rebuild', _f.signature;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
