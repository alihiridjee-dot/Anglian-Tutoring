# Database security audit — 1 October 2026

A read-only review of the live database (`peohauhwquuvghrpmotf`), building on
the empirical audits of 7 and 20 August. It covers what has changed since 4
September, including the three 1 October migrations, and re-reads every
SECURITY DEFINER function, every row-level-security policy on student data,
the grading and planner triggers, constraints, deletion behaviour, storage and
views. Everything was read from the live schema (`pg_proc`, `pg_policies`,
grants and constraints), not from the migration files. No personal data was
read. Nothing was changed.

Findings 1–3 are proven in `scripts/test-security-audit-2026-10-db.ts`, a
PGlite script built from the live definitions. It passes while they are open;
the PR that fixes one updates its assertion.

**Headline: no child-data hole found.** One student still can't read another's
work, a parent still can't reach an unlinked child, and nothing lets a student
grade themselves. Two findings matter in practice: quizzes ignore which subjects
were paid for (an entitlement gap), and a student can erase a whole conversation
with a tutor (a safeguarding-record gap). The rest are latent or operational.

Skipped as already assigned: live-session links (S-20), tutors editing each
other's notes (M-31), chat retention (M-26), the leads insert grant (S-38),
`claim_ai_request` (M-16), `invite_parent_by_email` (M-14), sign-up parent
codes (S-34) and homework submission visibility (M-21).

---

## Findings

### 1. Medium — Quizzes ignore which subjects were paid for

**Where:** policies `mcq_sets read` and `mcq_questions read via set`, and
`public.grade_mcq_attempt`.

**What goes wrong:** all three test `viewer_has_content_access`, which only asks
"does this viewer have *any* live plan?". A student paying for Biology alone can
list every published quiz in every subject, level and board, read its questions,
and grade it, and grading returns the correct answers. A linked parent can do
the same. Topics, spec points and resources were narrowed to the subjects paid
for in #88; quizzes were not. The answer key stays withheld at column level, so
this is an entitlement gap, not a way to read answers before one's own attempt.

**How sure:** certain. Reproduced in the PGlite script.

**Fix:** scope the two policies and the function's visibility check to
`private.my_content_subjects()`, as `topics read scoped` does. Consider level
and board too, so a GCSE student isn't served A-level sets.

### 2. Medium — A student can delete a whole conversation, the tutor's replies too

**Where:** `public.delete_chat_thread`.

**What goes wrong:** the thread's member (the student, or the parent on a parent
thread) can delete the thread outright, and its messages go with it by cascade.
That removes the tutor's side of the conversation as well, and nothing keeps a
copy. For a service tutoring children, the record of what an adult said to a
child is the record a safeguarding question would need.

**How sure:** certain. Reproduced in the PGlite script. This is how it was
built, so it's a decision to revisit rather than a bug.

**Fix:** let a member hide a thread from their own list (a per-side flag) rather
than delete it, and keep deletion for staff. Settle it alongside M-26's
retention rules.

### 3. Low (latent) — Sign-up grants the tutor role to one hard-coded address

**Where:** `public.handle_new_user`.

**What goes wrong:** when an account is created with one particular email
address, the trigger makes it a tutor. It fires when the account row is created,
before any email confirmation. It's safe today: that account exists (so the
address can't be registered again), email sign-ups need confirming, and the only
other provider in use, Google, verifies addresses. It becomes a route to staff
access if that account is ever deleted, email confirmation is turned off, or a
provider that passes unverified addresses is enabled.

**How sure:** certain about the behaviour (reproduced). The exposure today is
none.

**Fix:** remove the email clause and grant staff roles explicitly, by SQL, when
needed.

### 4. Low (latent) — Resource files are gated by enrolment, not payment

**Where:** storage policy `resources bucket read scoped`.

**What goes wrong:** a file attached to a resource is readable by anyone
enrolled in its subject (`is_enrolled_in`, which reads `enrolled_courses`)
or their parent. It doesn't check for a live plan, the resource's review
status, or level and board. A lapsed student keeps downloading, and a held sheet's
file is downloadable. No resource has a file today (`file_path` is empty on
every row), so nothing is exposed now.

**How sure:** certain, by reading. Latent.

**Fix:** match the `resources read scoped` rule: tutor, or a subject in
`private.my_content_subjects()` and the review gate.

### 5. Low — An unused upload path, with no limits, that outlives the account

**Where:** storage policies `resources bucket student upload` and `resources
bucket student delete acknowledged`; the `resources` bucket has no size or
type limit; `delete-account` purges only `avatars`.

**What goes wrong:** homework is answered on the site now and the app no longer
uploads submission files, but any student can still upload any file of any size
under `submissions/{their id}/`. Account deletion doesn't remove those files.
There are none today.

**How sure:** certain, by reading.

**Fix:** drop the two student policies (or set a size and type limit on the
bucket), and have `delete-account` remove `submissions/{id}/` as it does
avatars.

### 6. Low (operational) — Deleting a tutor's account fails, or deletes their notes

**Where:** foreign keys `weekly_focus.created_by` and
`student_weekly_tutor_notes.author_id` (ON DELETE NO ACTION), and
`student_tutor_notes.author_id` (ON DELETE CASCADE).

**What goes wrong:** removing a tutor who ever set a weekly focus or wrote a
weekly note is refused. Removing one who hasn't deletes every private note they
wrote about students.

**How sure:** certain, by reading the constraints.

**Fix:** make all three `ON DELETE SET NULL`, so the notes outlive their author.

### 7. Info — `profiles` insert grant includes role and access columns

**Where:** column grants on `public.profiles`.

**What goes wrong:** `authenticated` may INSERT `role`, `enrolled_courses` and
`student_invite_code`, under the policy `id = auth.uid()`. The sign-up trigger
always creates the profile first, so a client insert only conflicts. A profile's
`role` grants nothing on its own (staff access comes from `user_roles`). Not
reachable today.

**Fix:** revoke INSERT on `profiles` from clients, since the trigger creates every
row.

### 8. Info — `curriculum_coverage()` is callable without signing in

**Where:** `public.curriculum_coverage` (flagged by the Supabase advisor).

**What goes wrong:** anyone can read the course catalogue's topic and point
counts. Harmless, and only needed signed in.

**Fix:** revoke EXECUTE from `anon` unless the landing page needs it.

### 9. Info — Tutor overrides can duplicate under a race

**Where:** `student_plan_overrides` has only a primary key.

**What goes wrong:** two quick taps can store the same skip or remove twice.
Every reader tests with `exists`, so nothing breaks.

**Fix:** a unique index on (student, subject, spec point, kind, week).

---

## Checked and fine

- All 56 SECURITY DEFINER functions in `public` and `private` pin `search_path`.
- `anon` can execute only `curriculum_coverage` (finding 8) and two functions in
  `private`, which the API doesn't expose. Trigger functions can't be called by
  clients.
- Parent linking: `link_child_by_code` requires a parent caller, is rate-limited,
  accepts only students' codes and tells the child. `respond_to_parent_invite`
  binds to the caller's verified email and a parent role. Revoke, unlink and
  rotate act only on the caller's own rows. Invite codes are random, and none
  derives from a user id (health check H-1).
- Grading: `enforce_grading_privileges` guards inserts and updates of
  `homework_submissions`. Students can't insert `mcq_attempts`. Quiz answers and
  explanations are withheld at column level. `homework_answers` writes are
  tutor-only.
- Every per-student table: the student, a linked parent (read only) and staff,
  with `WITH CHECK` on writes. Check-ins are tied to the student's own plan.
- Planner triggers fire on update as well as insert, so a row can't be edited
  past them. Hand-picked points skip the pace rule by design, but are still
  course-checked.
- Chat: message reads and sends go through `chat_threads`' own row-level
  security, so an unlinked parent loses both. Only tutors update threads.
  Notifications go only to real tutors.
- Storage: both buckets are private. Avatars are owner-only.
- Row-level security is on for every table in `public`, and there are no views.
  The two tables with no policies (`stripe_cancellation_queue`, `trial_codes`)
  are service-only.
- Account deletion: the tables with no foreign key to the user
  (`homework_submissions`, `mcq_attempts`, `session_attendees`,
  `parent_student_links`) are purged explicitly by `delete-account`.
- Races that matter are held by unique keys: one point per plan week, one
  check-in per plan, one pending invite per address, one attendance per session,
  one homework sheet and one generated quiz per spec point.
- The 1 October migrations, read through their live results: paid-subject scope
  for topics, spec points and resources; `homework_mark_schemes()` and the
  withheld column; library rows without an owner; chat following the parent
  link.
