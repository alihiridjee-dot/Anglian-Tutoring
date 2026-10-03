-- M-40: the curriculum text importer writes a topic and its spec points in one
-- transaction, and says how many it wrote.
--
-- CurriculumSyncService inserted the topic, then each spec point in its own
-- request, skipped any insert that failed and still reported success. It also
-- published an empty "MCQ Set" for every point, which students saw at once.
--
-- This writes the topic and every point together, or nothing. Points keep the
-- order they were pasted in (sort_order), a code can't appear twice, and no
-- quiz sets are made. Security invoker: row-level security still decides who
-- may write (tutors only), exactly as for the requests it replaces.
--
-- _points is the topic's points in order: [{code, title, description?}].
-- Returns {"topic_id": <uuid>, "points": <how many were written>}.
create or replace function public.import_curriculum_topic(
  _subject public.subject,
  _board public.board,
  _level public.level,
  _topic_code text,
  _topic_title text,
  _topic_description text,
  _points jsonb
)
 returns jsonb
 language plpgsql
 security invoker
 set search_path to ''
as $function$
declare
  _tid uuid;
  _n int;
begin
  if coalesce(btrim(_topic_title), '') = '' then
    raise exception 'The topic needs a title.';
  end if;
  if jsonb_typeof(_points) is distinct from 'array' or jsonb_array_length(_points) = 0 then
    raise exception 'There are no spec points to import.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(_points) e
    where coalesce(btrim(e->>'code'), '') = ''
       or coalesce(btrim(e->>'title'), '') = ''
  ) then
    raise exception 'Every spec point needs a code and a title.';
  end if;
  if (select count(distinct btrim(e->>'code')) from jsonb_array_elements(_points) e)
     <> jsonb_array_length(_points) then
    raise exception 'A spec point code appears twice.';
  end if;

  insert into public.topics(board, level, subject, code, title, description, created_by, sort_order)
  values (
    _board, _level, _subject,
    nullif(btrim(_topic_code), ''),
    btrim(_topic_title),
    nullif(btrim(_topic_description), ''),
    (select auth.uid()),
    100 -- manually added topics sit below the loaded ones
  )
  returning id into _tid;

  insert into public.spec_points(topic_id, code, title, description, created_by, sort_order)
  select
    _tid,
    btrim(e.value->>'code'),
    btrim(e.value->>'title'),
    nullif(btrim(e.value->>'description'), ''),
    (select auth.uid()),
    (e.ordinality - 1)::int
  from jsonb_array_elements(_points) with ordinality as e(value, ordinality);
  get diagnostics _n = row_count;

  return jsonb_build_object('topic_id', _tid, 'points', _n);
end;
$function$;

revoke all on function public.import_curriculum_topic(
  public.subject, public.board, public.level, text, text, text, jsonb
) from public;
revoke all on function public.import_curriculum_topic(
  public.subject, public.board, public.level, text, text, text, jsonb
) from anon;
grant execute on function public.import_curriculum_topic(
  public.subject, public.board, public.level, text, text, text, jsonb
) to authenticated;
