-- Rollback for 20261007111000_practice_queue_this_week_only: a row written in
-- any week queues its point again, as 20261005220000 had it. The waiting jobs
-- the migration removed are not put back; the old trigger queues a point again
-- the next time a row holding it is written.
create or replace function private.enqueue_practice_for_plan_point()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  begin
    perform private.enqueue_practice(new.spec_point_id);
  exception when others then
    raise warning 'practice queue: could not enqueue %: %', new.spec_point_id, sqlerrm;
  end;
  return null;
end;
$function$;

revoke all on function private.enqueue_practice_for_plan_point() from public, anon, authenticated;
