-- Grading fields on homework_submissions are tutor/admin-only.
--
-- The "hs student own" policy is FOR ALL, and students legitimately need
-- INSERT/UPDATE on their own row: the submit flow is an upsert that rewrites
-- files/notes/submitted_at on resubmission. RLS is row-level, and both students
-- and tutors arrive as the same `authenticated` Postgres role, so no policy or
-- column GRANT can separate "may edit my own submission" from "may grade it".
-- A trigger is the only place that distinction can be enforced.

-- SECURITY DEFINER is required, not incidental: `authenticated` has no USAGE on
-- schema private, so an invoker-rights trigger dies with "permission denied for
-- schema private" on every student submission. RLS policies get away with
-- calling private.has_role because policy expressions run as the table owner;
-- a trigger does not.
create or replace function public.enforce_grading_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_privileged boolean;
begin
  -- service_role covers trusted server contexts (migrations, admin tooling),
  -- which bypass RLS but still fire triggers.
  v_privileged :=
    coalesce(auth.role(), '') = 'service_role'
    or private.has_role(auth.uid(), 'tutor'::public.app_role)
    or private.has_role(auth.uid(), 'admin'::public.app_role);

  if v_privileged then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Closes the upsert-insert path: a first-time submission may not arrive
    -- pre-graded.
    if new.grade is not null
       or new.score_pct is not null
       or new.feedback is not null
       or new.graded_by is not null
       or new.graded_at is not null then
      raise exception 'Only tutors or admins may set grading fields'
        using errcode = '42501';
    end if;
  else
    if new.grade is distinct from old.grade
       or new.score_pct is distinct from old.score_pct
       or new.feedback is distinct from old.feedback
       or new.graded_by is distinct from old.graded_by
       or new.graded_at is distinct from old.graded_at then
      raise exception 'Only tutors or admins may set grading fields'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_grading_privileges on public.homework_submissions;

create trigger trg_enforce_grading_privileges
before insert or update on public.homework_submissions
for each row execute function public.enforce_grading_privileges();
