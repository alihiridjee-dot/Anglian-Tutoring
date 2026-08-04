-- Who a student may address a question to.
--
-- Students cannot read tutor profiles (RLS on public.profiles is self / linked
-- parent / tutor), and they shouldn't be able to — but they do need to pick a
-- tutor by name. This exposes exactly two columns and nothing else: no email,
-- no role table, no way to enumerate anyone who isn't staff.
--
-- Derived from user_roles, so it stays identity-agnostic: a new tutor account
-- appears here the moment it is granted the role, and no name is ever hardcoded.
create or replace function public.tutor_directory()
returns table (id uuid, display_name text)
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select p.id, coalesce(nullif(btrim(p.display_name), ''), 'Tutor')
  from public.profiles p
  join public.user_roles r on r.user_id = p.id and r.role = 'tutor'::public.app_role
  where (select auth.uid()) is not null
  order by 2
$$;

revoke all on function public.tutor_directory() from public, anon;
grant execute on function public.tutor_directory() to authenticated;

-- Messages addressed to the caller that they haven't seen.
--
-- Which watermark applies depends on which side of the thread you are, so the
-- rule lives here rather than being re-derived by every caller (the sidebar
-- badge, the inbox, the bell).
create or replace function public.chat_unread_count()
returns integer
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select coalesce(count(m.id), 0)::int
  from public.chat_messages m
  join public.chat_threads t on t.id = m.thread_id
  where (select auth.uid()) is not null
    and m.sender_id <> (select auth.uid())
    and (
      (t.student_id = (select auth.uid())
        and m.created_at > coalesce(t.student_last_read_at, '-infinity'::timestamptz))
      or (private.has_role((select auth.uid()), 'tutor'::public.app_role)
        and t.student_id <> (select auth.uid())
        and m.created_at > coalesce(t.tutor_last_read_at, '-infinity'::timestamptz))
    )
$$;

revoke all on function public.chat_unread_count() from public, anon;
grant execute on function public.chat_unread_count() to authenticated;

-- Marks the caller's OWN side of a thread read.
--
-- An RPC rather than a client UPDATE because the column to write depends on who
-- is asking, and a client that picked the wrong one could clear the other
-- party's unread badge. The UPDATE policy allows both sides to touch the row;
-- this is what keeps each of them to their own watermark.
create or replace function public.mark_chat_thread_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_student uuid;
begin
  select student_id into v_student from public.chat_threads where id = p_thread_id;
  if not found then return; end if;

  if v_student = auth.uid() then
    update public.chat_threads set student_last_read_at = now() where id = p_thread_id;
  elsif private.has_role(auth.uid(), 'tutor'::public.app_role) then
    update public.chat_threads set tutor_last_read_at = now() where id = p_thread_id;
  end if;
end;
$$;

revoke all on function public.mark_chat_thread_read(uuid) from public, anon;
grant execute on function public.mark_chat_thread_read(uuid) to authenticated;
