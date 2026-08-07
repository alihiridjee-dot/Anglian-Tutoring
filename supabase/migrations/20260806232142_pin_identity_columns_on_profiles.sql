-- A profile row holds two very different kinds of field, and until now one
-- grant governed both.
--
-- "profiles self update" allows a signed-in user to update their own row, and
-- `authenticated` held a column privilege on every column in it. The app only
-- ever writes four — display_name, phone, school, level — but the API is the
-- surface, not the app, and three of the others are load-bearing:
--
--   • role                — decides which dashboard renders client-side, gates
--                           `link_child_by_code` (parent-only), and selects a
--                           branch of `private.viewer_has_content_access`.
--   • student_invite_code — the credential a parent redeems to attach
--                           themselves to a child's account.
--   • enrolled_courses    — the denormalised list `private.my_content_subjects()`
--                           reads, which *is* the subject scope of the
--                           curriculum, resources, spec-point and quiz read
--                           policies. One PATCH to this column widened what its
--                           own author could read.
--
-- None of those are the user's to assert, so the privilege to write them is
-- withdrawn. A column REVOKE is the right primitive rather than a WITH CHECK
-- comparing against the old row: that check would have to SELECT from
-- `profiles` inside a `profiles` policy, which Postgres rejects as infinite
-- recursion. The grant is checked before any policy runs and cannot be talked
-- around.
--
-- `enrolled_courses` still has to change when a student picks subjects, so
-- `save_student_enrolments` — its single writer, which already scopes every
-- statement to `auth.uid()` — becomes SECURITY DEFINER and keeps doing it.

-- 1. The one legitimate writer no longer needs the caller to hold the privilege.
create or replace function public.save_student_enrolments(_subjects jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _uid uuid := auth.uid();
  _keep text[];
begin
  if _uid is null then
    raise exception 'not signed in';
  end if;
  if jsonb_typeof(coalesce(_subjects, '[]'::jsonb)) <> 'array' then
    raise exception 'subjects must be an array';
  end if;
  if jsonb_array_length(coalesce(_subjects, '[]'::jsonb)) > 20 then
    raise exception 'too many subjects';
  end if;

  select coalesce(array_agg(distinct e->>'subject'), '{}'::text[])
  into _keep
  from jsonb_array_elements(coalesce(_subjects, '[]'::jsonb)) e;

  -- Drop de-selected subjects: narrowing from three to one must actually
  -- remove access to the other two, which an upsert alone would not do.
  --
  -- SECURITY DEFINER bypasses RLS, so the `= _uid` on every statement below is
  -- now the only thing holding this to the caller's own rows. _uid comes from
  -- auth.uid(), never from an argument, so there is nothing to pass in.
  delete from student_enrolments
  where student_id = _uid
    and (_keep = '{}'::text[] or subject::text <> all (_keep));

  insert into student_enrolments (student_id, subject, board)
  select _uid, (e->>'subject')::subject, (e->>'board')::board
  from jsonb_array_elements(coalesce(_subjects, '[]'::jsonb)) e
  on conflict (student_id, subject) do update set board = excluded.board;

  -- The denormalised list many reads (and the content RLS) still use. Moving in
  -- the same transaction as the rows above is the whole point of this function.
  update profiles set enrolled_courses = _keep where id = _uid;
end
$function$;

revoke all on function public.save_student_enrolments(jsonb) from public, anon;
grant execute on function public.save_student_enrolments(jsonb) to authenticated;

-- 2. Withdraw the privilege itself.
--
-- NOTE: this statement is a NO-OP, and is left here because it is what was
-- applied. A table-level UPDATE grant already covers every column, and a
-- column-level REVOKE cannot carve a hole in it — the grant has to be dropped
-- and re-issued. That correction is the next migration,
-- `20260806232240_pin_identity_columns_on_profiles_grant_fix`, which is what
-- actually closes the hole. Verify with information_schema.column_privileges
-- after either one; the check is what caught this.
revoke update (role, student_invite_code, enrolled_courses) on public.profiles from authenticated;

-- 3. `anon` never had a policy letting it write here at all, so these grants
--    were dead weight standing one policy mistake away from being live. (This
--    one does work: it targets the table-level grant directly.)
revoke insert, update on public.profiles from anon;
