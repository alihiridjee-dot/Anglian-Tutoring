-- A submission is final once made: students may create their own submission,
-- but never edit or delete it afterwards.
--
-- Replaces the single "hs student own" FOR ALL policy, which granted students
-- UPDATE and DELETE on their own row — letting them resubmit over a graded
-- submission, or delete a bad grade and start again. The UNIQUE (resource_id,
-- student_id) constraint makes the INSERT-only grant sufficient to enforce
-- exactly one submission per student per homework.
--
-- Storage already matches this: students can INSERT under submissions/<uid>/%
-- but only tutors/admins can delete objects, so uploaded work cannot be
-- removed after the fact either. Correcting a wrong file happens before
-- submitting, in the client's staged file list.
--
-- The enforce_grading_privileges trigger stays: the INSERT grant below still
-- allows a student to supply a payload, and the trigger is what stops that
-- payload arriving pre-graded.

drop policy if exists "hs student own" on public.homework_submissions;

create policy "hs read scoped"
  on public.homework_submissions for select to authenticated
  using (
    auth.uid() = student_id
    or private.has_role(auth.uid(), 'tutor'::public.app_role)
    or private.has_role(auth.uid(), 'admin'::public.app_role)
    or exists (
      select 1 from public.parent_student_links l
      where l.parent_id = auth.uid() and l.student_id = homework_submissions.student_id
    )
  );

-- Students submit once; the unique constraint rejects any second attempt.
create policy "hs student submit"
  on public.homework_submissions for insert to authenticated
  with check (
    auth.uid() = student_id
    or private.has_role(auth.uid(), 'tutor'::public.app_role)
    or private.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- Grading is the only legitimate mutation, and only tutors/admins do it.
create policy "hs tutor grade"
  on public.homework_submissions for update to authenticated
  using (
    private.has_role(auth.uid(), 'tutor'::public.app_role)
    or private.has_role(auth.uid(), 'admin'::public.app_role)
  )
  with check (
    private.has_role(auth.uid(), 'tutor'::public.app_role)
    or private.has_role(auth.uid(), 'admin'::public.app_role)
  );

create policy "hs tutor delete"
  on public.homework_submissions for delete to authenticated
  using (
    private.has_role(auth.uid(), 'tutor'::public.app_role)
    or private.has_role(auth.uid(), 'admin'::public.app_role)
  );
