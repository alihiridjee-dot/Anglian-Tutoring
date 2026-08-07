# Security & guardrail audit — 7 August 2026

Full sweep of the access-control surface: every RLS policy on all 39 public
tables, every column and function grant, all 27 SECURITY DEFINER functions, the
storage bucket policies, every server function, and the client-side guards.

Three live holes were found and closed. The rest of this document records what
was verified sound, and what remains open for a decision that isn't mine to make.

---

## Fixed — applied to production

### 1. CRITICAL — anyone could mint themselves a tutor account

`handle_new_user` read `raw_user_meta_data->>'role'` and, if it said `tutor`,
inserted a `tutor` row into `user_roles`.

That column is the `options.data` bag of `supabase.auth.signUp()` — entirely
attacker-controlled, from an unauthenticated public endpoint:

```js
supabase.auth.signUp({ email, password, options: { data: { role: "tutor" } } })
```

`private.has_role(uid, 'tutor')` is the predicate behind almost every policy in
the schema. One sign-up therefore granted:

- every student's profile — name, phone number, school, level, invite code
- every homework submission, its marks, its feedback, and its files in Storage
- every private chat thread between a student and their tutor
- every quiz attempt and every lead in the CRM
- write access to the whole curriculum, and to `parent_student_links` — i.e. the
  ability to attach yourself to any child's account as their "parent"

In other words: the platform's complete records on its children, from the sign-up
form, in a single request.

**Fixed** — `20260806232130_never_grant_staff_role_from_signup_metadata.sql`. A
self-declared role is now only ever a *profile* role and only `student` or
`parent`; anything else falls back to `student`. `user_roles` is never written
from metadata. Staff access is granted out of band.

*Not exploited.* `user_roles` holds exactly one tutor and seven students, which
matches the intended state.

The bootstrap branch for `asa180@live.co.uk` is kept, so the project isn't left
unable to create its first tutor. It is unreachable: that account already exists
and is confirmed, and `auth.users.email` is unique.

### 2. HIGH — a student could widen their own content access

`profiles` had a table-level UPDATE grant for `authenticated` and a self-update
policy with no column restriction. The app only ever writes four fields. Three
of the others are load-bearing:

| Column | What writing it bought |
| --- | --- |
| `enrolled_courses` | **The subject scope of the content policies.** `private.my_content_subjects()` reads it directly, and `student_has_access()` only asks whether *a* subscription exists — not which subjects it covers. One PATCH adding `chemistry` and `physics` unlocked the full curriculum, resources, spec points and quizzes for subjects that were never paid for. |
| `role` | Flips the client-side dashboard, and is the gate on `link_child_by_code` (parent-only). A student could make themselves a "parent" and start redeeming invite codes. |
| `student_invite_code` | The credential a parent redeems to attach to a child's account. |

**Fixed** — `20260806232142_pin_identity_columns_on_profiles.sql` plus
`20260806232240_..._grant_fix.sql`. The table-level grant is dropped and
re-issued for `display_name, phone, school, level, onboarding_completed_at`
only. `save_student_enrolments` — the single legitimate writer of
`enrolled_courses` — is now SECURITY DEFINER, with every statement still scoped
to `auth.uid()`. `anon`'s vestigial INSERT/UPDATE grants are gone.

> A column-level `REVOKE` was the obvious move and is a **no-op** here: a
> table-level grant already covers every column and cannot be carved into. The
> grant has to be dropped and re-issued. The first attempt at this migration got
> it wrong and the verification query is what caught it.

### 3. MEDIUM-HIGH — quiz scores could be fabricated

`grade_mcq_attempt` was added so marking happens server-side against the stored
`correct_index`, and the client was moved onto it — but the door it replaced was
left open. The `attempts self insert` policy plus full column grants meant:

```
POST /rest/v1/mcq_attempts  {"set_id": …, "user_id": me, "score": 20, "total": 20}
```

wrote a perfect paper. `authenticated` also held UPDATE on every column, with no
policy granting it — the only thing preventing a student from rewriting last
term's marks was the *absence* of a policy rather than the absence of a
privilege.

This isn't a vanity number. An attempt feeds the predicted grade shown to the
parent, the FSRS ledger that decides when a topic returns, and the tutor's read
on who is struggling. Inflating it quietly deletes your own weak topics from the
schedule — the exact failure the product exists to prevent.

**Fixed** — `20260806232154_quiz_scores_only_from_the_grader.sql`. Policy
dropped, INSERT/UPDATE revoked from `anon` and `authenticated`.
`grade_mcq_attempt` is SECURITY DEFINER so it keeps writing. Reads are untouched.
No client code inserted directly, so nothing broke.

---

## Open — needs a decision, not a patch

### 4. Entitlement doesn't know which subjects were paid for

Even with #2 closed, `save_student_enrolments` still lets a student set their own
subject list to all three, and `private.student_has_access()` only checks that a
subscription is `active`/`trialing`. The `subscriptions` table has no per-subject
record — just `plan`, a text column — so the database *cannot* currently check
that a student's subjects match what they bought.

Practically: **a student paying for one subject can self-serve all three.**

This is a billing-model question rather than a bug, which is why I have not
touched it. The fix is to record the purchased subjects on the subscription (the
Stripe webhook already knows them) and have `my_content_subjects()` intersect
the declared list with the paid one.

### 5. `link_child_by_code` has no throttle

An authenticated parent may call it unlimited times, and it distinguishes
`not_found` from `already_linked`. At ~40 bits of entropy a guess needs ~10¹²
attempts, so this is not currently exploitable over HTTP — but a successful guess
links a stranger to a child's account and everything in it. Worth a quota
(`claim_ai_request` is the pattern) before the code length is ever shortened.

`architecture.md` claimed no such RPC existed; that claim is now corrected.

### 6. Leaked-password protection is off

Supabase Auth can check new passwords against HaveIBeenPwned. One toggle,
Authentication → Policies. Worth turning on for an account holding children's
data.

### 7. The public contact form has no spam controls

`ContactSection` inserts straight into `leads` with no honeypot and no rate
limit, and the table already contains SEO spam. The new demo chat has both — the
same treatment on the contact form is a small change worth making.

---

## Verified sound

- **RLS is enabled on all 39 public tables**, with no table left permissive.
- **Storage** — `resources` is private. Students read only
  `submissions/{own uid}/…` plus files for subjects they're enrolled in; parents
  only their linked child's; tutors all. Signed URLs are issued by a server
  function bound to the *caller's* JWT, so RLS decides each path; traversal and
  absolute paths are rejected, TTL is clamped to [30s, 1h], and a denial and a
  missing file return the same message so existence isn't leaked.
- **Homework grades** are already protected the right way, by the
  `enforce_grading_privileges` trigger — a student cannot set `grade`,
  `score_pct`, `feedback`, `graded_by` or `graded_at` on insert or update. #3
  above is that same guard, which `mcq_attempts` was missing.
- **`grade_mcq_attempt` re-checks visibility explicitly** because SECURITY
  DEFINER bypasses RLS. Without that check any signed-in caller could grade —
  and therefore read the answers to — unpublished drafts from other courses. The
  comment in the function says so, and it's correct.
- **Chat** — `chat_messages` has no UPDATE or DELETE policy, so neither side
  rewrites history. Read watermarks go through `mark_chat_thread_read()` rather
  than a client UPDATE. The AI draft is tutor-gated *server-side* before spending
  credits, so a student can't use it as a free answer service. The fan-out
  trigger is revoked from `anon`/`authenticated`, which matters because PostgREST
  otherwise exposes every `public` function as an RPC.
  - *Note:* the `chat_threads`/`chat_messages` policies are granted to `public`
    rather than `authenticated`, unlike the rest of the schema. Safe in practice
    — every predicate compares against `auth.uid()`, which is NULL for `anon` —
    but it's the odd one out and would be worth aligning.
- **Parent access** is a `parent_student_links` row and nothing else; pending
  invites live in a separate table that grants nothing. Writes go through
  SECURITY DEFINER RPCs.
- **Server functions** are all behind `requireSupabaseAuth`, which validates the
  bearer token with `getClaims` rather than trusting it. The one exception is the
  new `sendWhatsAppLead`, which is deliberately public and carries its own
  validation, honeypot, per-IP limit and global send cap.
- **Demo isolation** — `/demo/*` has no session and no account to sign into.
  `isDemoMode()` derives from the pathname, so it can't be left on by a stale
  flag, and every data hook short-circuits to fixtures. The `is_demo` /
  `demo_visible` columns are confirmed gone from the database.
- **Open redirect** — `auth.tsx` only honours a `?redirect=` that starts with a
  single `/`.
- `curriculum_coverage()` is anon-executable, which the advisor flags. It returns
  only aggregate topic counts per level/board/subject and feeds the public
  landing page. Intentional, and it exposes nothing about any student.
- `stripe_cancellation_queue` has RLS on and no policies, which the advisor
  reports as INFO. That is deny-all to `anon` and `authenticated` and is correct
  — only the service role touches it.
- Default `TRUNCATE`/`REFERENCES` grants to `anon`/`authenticated` exist (they're
  Supabase defaults) and RLS does not apply to TRUNCATE. Not reachable: PostgREST
  exposes no path to it, and the anon key is a PostgREST JWT, not database
  credentials. Hygiene, not a live risk.

---

## How to re-run this

```bash
supabase db lint --project-ref peohauhwquuvghrpmotf
```

The queries behind this audit are in the session transcript; the useful ones are
`pg_policies` joined to `pg_policy` for the raw expressions,
`information_schema.column_privileges` for grants (check the **table**-level
grant too — a column revoke can silently do nothing), and `pg_proc.prosecdef`
for the SECURITY DEFINER set.
