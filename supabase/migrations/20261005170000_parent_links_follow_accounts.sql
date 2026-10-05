-- Parent links: deleted with the account at either end.
--
-- parent_student_links had no foreign keys, so a link outlived a deleted
-- account. The delete-account purge removes a student's links itself, but it
-- only ever deletes students: a parent, or anyone deleted from the dashboard,
-- left their links behind. On 5 Oct 2026, 5 of the 6 links in production named
-- a deleted account. Four joined the test student to parent accounts deleted in
-- July and September, and one joined two deleted accounts.
--
-- Such a link grants nothing, since its parent can't sign in, but it still
-- counts as a parent. book_break told it about a break and failed on
-- notifications_user_id_fkey (fixed in 20261005163000). stripe-checkout and the
-- billing_feedback policy leave the plan to a parent who no longer exists. The
-- tutor's student record lists it as a parent with no name.
--
-- So: delete those links, then make both ids reference auth.users with ON
-- DELETE CASCADE, as the student tables do. A link now goes with either
-- account in the same transaction, whatever deletes it, and a link naming an
-- account that doesn't exist is refused.
--
-- Each link removed, here or by a cascade, fires psl_rotate_invite_code, as
-- unlink_parent does, so the student gets a new invite code. The test
-- student's code changes; their link to Ali's parent account stays.
--
-- Safe to run twice. Adding a foreign key stops writes to auth.users until the
-- transaction ends, so sign-ins wait for it. The lock timeout makes a busy
-- table fail this, to be run again, rather than hold every sign-in behind it.
do $$
begin
  perform set_config('lock_timeout', '5s', true);

  delete from public.parent_student_links l
   where not exists (select 1 from auth.users u where u.id = l.parent_id)
      or not exists (select 1 from auth.users u where u.id = l.student_id);

  if not exists (select 1 from pg_constraint where conname = 'parent_student_links_parent_id_fkey'
                 and conrelid = 'public.parent_student_links'::regclass) then
    alter table public.parent_student_links add constraint parent_student_links_parent_id_fkey
      foreign key (parent_id) references auth.users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'parent_student_links_student_id_fkey'
                 and conrelid = 'public.parent_student_links'::regclass) then
    alter table public.parent_student_links add constraint parent_student_links_student_id_fkey
      foreign key (student_id) references auth.users(id) on delete cascade;
  end if;
end
$$;
