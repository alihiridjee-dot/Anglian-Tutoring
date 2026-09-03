# Security & guardrail audit — 20 August 2026

A live brute-test of the access-control surface against production
(`peohauhwquuvghrpmotf`), following up the 7 August sweep. This pass was
**empirical**: as well as reading the policies, it exercised them with real
anonymous and authenticated requests, including disposable confirmed test users
minted through the Auth admin API and signed in for genuine JWTs. Every test
artifact created was deleted; a post-run sweep confirmed none remained.

**Headline: child-data isolation is sound.** No anonymous read of any student
record, no cross-tenant read between signed-in students, no privilege
escalation, and no cross-child access to uploaded homework files. The three
holes closed on 7 August were re-verified closed on live data. Two abuse-hardening
gaps were fixed, one entitlement (revenue) gap was found exploitable and half-fixed
pending a billing decision, and one Auth setting needs turning on in the dashboard.

---

## Verified sound (empirically, against production)

- **Anonymous REST sweep** over all 37 tables: only `packages` (public pricing)
  returns rows. Every student-data table returns `[]`. Single-row insert probes
  on `profiles`, `user_roles`, `parent_student_links`, `subscriptions`,
  `mcq_attempts`, `chat_messages`, `resources`, `spec_points`, `stripe_customers`
  are all denied by RLS (`42501`). The OpenAPI enumeration endpoint refuses the
  publishable key, so the schema isn't advertised to anonymous callers.

- **Authenticated cross-tenant read** — a fresh test student, with 3 real
  students' data present in the database, read **0 foreign rows** across all 26
  data tables (profiles, chat, homework, every `student_*`, subscriptions,
  stripe_customers, parent_student_links, …). Each returned only the caller's own
  rows.

- **Privilege escalation** — as a signed-in student, all denied:
  - insert `user_roles{role:tutor}` → RLS denied
  - `PATCH profiles.role → tutor` → permission denied (column grant)
  - `PATCH profiles.enrolled_courses` → permission denied (column grant) — fix #2 holds
  - insert own `subscriptions{status:active}` → RLS denied
  - insert `mcq_attempts{score:20}` → permission denied — fix #3 holds
  - insert `parent_student_links` to grab a child → RLS denied
  - write homework `grade` → blocked by `enforce_grading_privileges` trigger
  - insert `stripe_customers` → RLS denied

- **Signup role injection** (the 7 Aug critical) — `signUp` /
  `admin.createUser` with `data:{role:"tutor", enrolled_courses:[3 subjects]}`
  produced a **student** profile with `enrolled_courses = []`. Metadata cannot
  mint staff or widen access. Fix #1 holds on live.

- **Storage / homework files** — a real child's submission
  (`submissions/{childId}/…/*.pdf`) could **not** be signed by an anonymous
  caller or by an unrelated signed-in student; both got the same generic
  `not_found` (existence not leaked). Listing another child's folder returned
  `200` with **0 rows** (RLS filters the listing). Students are scoped to
  `submissions/{own uid}/…`.

- **Edge functions** — `stripe-webhook` verifies `STRIPE_WEBHOOK_SECRET` via
  `constructEventAsync` before trusting anything. `zoom-meeting` returns 401 to
  anon and **403 to a signed-in student** (tutor/admin only), so host `start_url`s
  don't leak. `stripe-checkout` enforces auth per-action (401 to anon on both
  `checkout` and `invoices`) and authorizes the beneficiary
  (`assertCanManage`/`assertCanUpgrade`): a caller can only act on their own, their
  payer's, or a linked child's subscription — no cross-family IDOR.

---

## Fixed in this pass

### A. MEDIUM — contact form had no spam controls (was open item #7)

`ContactSection` inserted straight into `leads` through the anon client with no
honeypot and no rate limit, while the demo sales chat already had both. A probe
insert landed a row in the CRM on the first try.

**Fixed** — new server function `src/lib/contactLead.functions.ts`
(`submitContactLead`): honeypot field + per-IP sliding-window limit (4 / 10 min,
reusing `lib/rateLimit.ts`), insert still through the anon key so the
`leads public insert` RLS `CHECK` continues to validate every field.
`ContactSection.tsx` now calls it and carries a hidden, non-tab-reachable
honeypot input.

### B. MEDIUM — `link_child_by_code` had no throttle (was open item #5)

An authenticated parent account could call the invite-code redemption RPC in an
unbounded loop. At ~40 bits the code isn't guessable over HTTP today, but nothing
bounded the attempt rate and the code length is the kind of thing shortened later
for readability. A successful guess links a stranger to a child's account.

**Fixed** — `supabase/migrations/20260820120000_throttle_link_child_by_code.sql`.
The RPC now spends one durable, race-safe token per submission via the existing
`claim_ai_request` limiter (10 / hour / parent), returning a new `rate_limited`
status the UI explains. The throttle sits after the parent-role gate and before
the code lookup, so a wrong guess costs the same as a right one and non-parent
noise can't lock a real parent out. Client updated (`useParentLinks.ts`,
`parents.tsx`).

### C. HIGH (entitlement / revenue, not data-safety) — pay for one subject, read three (was open item #4)

**Confirmed exploitable end-to-end against production**, reachable through the
real UI: a student on an active `weekly_1` plan (one subject) whose
`enrolled_courses` lists three subjects read the entire curriculum — 123 topics
across biology, chemistry and physics. Two independent gaps combine:

1. `save_student_enrolments` (the only writer of `enrolled_courses`, which *is*
   the content-RLS subject scope) accepted up to 20 subjects regardless of the
   plan.
2. `stripe-checkout`'s `handleCheckout` trusted a **client-supplied `tier`**
   rather than deriving the subject count from enrolments — so a pupil could
   declare three subjects in onboarding, then check out on `weekly_1`. (The
   `add_subjects` / `remove_subjects` / `change_cadence` handlers already derive
   the count server-side; only initial checkout did not.)

**Fix (half self-contained, half needs your sign-off before deploy):**
- `supabase/migrations/20260820130000_cap_enrolments_to_paid_subject_count.sql`
  adds `private.my_paid_subject_cap()` and makes `save_student_enrolments` reject
  a declaration exceeding the live plan's count. Silent when there's no
  active/trialing subscription (onboarding, lapsed) or on legacy flat tiers, so
  it never blocks onboarding and never accuses a paying student.
- `stripe-checkout/index.ts` `handleCheckout` now forces the count from
  server-side enrolments (`${cadence}_${enrolledCount}`, clamped `[1,3]`) instead
  of trusting the client tier.

Both are needed to close it fully. **The checkout change touches the live payment
path and is not yet deployed** — review the pricing invariant (should initial
checkout ever sell fewer subjects than a student is enrolled in?) before shipping.

---

## Open — needs an action outside code

### D. Leaked-password protection is OFF (was open item #6)

Signup with the password `password` (the single most-breached password) was
accepted on live. `supabase/config.toml` sets `hibp_enabled = true`, but that
local config was never pushed to the hosted Auth settings.

**Action:** Dashboard → Authentication → Policies → enable "Leaked password
protection". One toggle; nothing in code. Worth it for an account holding
children's data. (Cannot be done from here — it's a hosted security setting.)

### E. Confirm who holds `tutor` access

`user_roles` currently holds **2 tutor** rows (the 7 Aug audit recorded 1). No
tutor was created during this audit. Tutor/admin is the widest door — full read
of every child's profile, files, chat and grades — so confirm both accounts are
intended staff.

---

## How to re-run

Anonymous and authenticated probes were driven with `curl` and short Bun scripts
against the production REST/Storage/Auth endpoints using the keys in `.env`.
Authenticated tests create confirmed users via `POST /auth/v1/admin/users`
(service role), sign in via `POST /auth/v1/token?grant_type=password`, run the
matrix, then `DELETE /auth/v1/admin/users/{id}` (cascades to profile + roles).
Always confirm the post-run cleanup sweep shows zero `@test.invalid` users and no
probe `leads`.
