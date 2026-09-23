-- DOWN for migrations/20260923081108_tutor_student_management.sql.
--
-- Kept out of supabase/migrations on purpose: the CLI applies everything in
-- that folder, in order, and a rollback must only ever run by hand.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -f supabase/rollbacks/20260923081108_tutor_student_management.down.sql
--
-- Drops the notes table (and every note in it), the two RPCs and the tutor
-- update policy on enrolments, and restores the billing_feedback insert policy
-- to its 20260803120000 definition. "profiles tutor read" is left in place: it
-- predates this migration in production, and removing it would blank the
-- marking queue, the planner roster and the student list.

begin;

drop trigger if exists student_tutor_notes_touch on public.student_tutor_notes;
drop function if exists private.touch_student_tutor_note();
drop table if exists public.student_tutor_notes;

drop policy if exists "enrolments tutor update" on public.student_enrolments;

drop function if exists public.tutor_set_student_level(uuid, public.level);
drop function if exists public.tutor_student_directory();

drop policy if exists "billing feedback insert manager" on public.billing_feedback;
create policy "billing feedback insert manager" on public.billing_feedback
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (
      exists (
        select 1 from public.subscriptions s
        where s.student_id = billing_feedback.student_id
          and s.user_id = auth.uid()
      )
      or exists (
        select 1 from public.parent_student_links l
        where l.parent_id = auth.uid() and l.student_id = billing_feedback.student_id
      )
      or (
        auth.uid() = billing_feedback.student_id
        and not exists (
          select 1 from public.parent_student_links l
          where l.student_id = billing_feedback.student_id
        )
      )
    )
  );

commit;
