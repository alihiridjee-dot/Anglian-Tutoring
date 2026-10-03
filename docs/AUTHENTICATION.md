# Authentication & Session Management

This document describes how the app tells a **signed-in user** from the
**sales showcase**, how protected routes are guarded, and which of the two you
test against.

## Principles

1. **Every signed-in state is a real Supabase session.** There is no client-side
   "bypass" flag that grants access.
2. **Data isolation is enforced server-side by Row-Level Security (RLS)** — never
   by hiding data in the frontend. Guards and `enabled:` flags shape the UI; they
   are not access control.
3. **The showcase has no account and no session.** It is not a restricted user.
   It is the real page components fed hardcoded fixtures.

## The two environments

|               | Signed-in user                 | Sales showcase (`/demo/*`)                                            |
| ------------- | ------------------------------ | --------------------------------------------------------------------- |
| Purpose       | The product                    | **Sales only** — a look around before buying                          |
| Session       | Real Supabase session          | None                                                                  |
| How you enter | `/auth` sign in / sign up      | Navigate to `/demo`                                                   |
| Data          | Live rows, scoped by RLS       | Fixtures in `src/lib/demo/studentDemo.ts`                             |
| Writes        | Real                           | None — quizzes are marked locally, forms are read-only                |
| Guard         | `/_authenticated` `beforeLoad` | Sits outside the guard entirely                                       |
| Rendering     | Client only (`ssr: false`)     | Client only (`ssr: false`) for `/demo/student/*` and `/demo/parent/*` |

There are **no demo accounts**. The `demo.student@…` / `demo.parent@…` users,
`enterDemoMode`, the `is_demo` / `demo_visible` columns and
`private.is_demo_user()` were all removed in 2026-07. Don't bring them back.

The showcase pages skip the server render because showcase mode is read off
`window.location`, which the server doesn't have: rendered there, a demo page
comes out as a _live_ page with nobody signed in, and React discards it with a
hydration error.

## Testing: use the test account, not the showcase

> **The showcase is for sales. It is not a test environment.**

Because it has no session and reads fixtures, the showcase never touches the
route guard, RLS, the paywall, a real query or a real write. A change that works
in `/demo/*` has been shown to render, and nothing more.

End-to-end testing of the platform is done signed in as the dedicated test
student, or as the test parent linked to it. These are the only two accounts
to test on:

- **Student:** `123@123.com`
- **Parent:** the parent account linked to `123@123.com`. Use it for anything a
  parent sees: the Parent Portal, parent messaging, linking and billing.
- **Designed for testing.** Neither has an active card, so nothing can be charged.
- **They are real accounts on the live project, so their writes are real.**
  Submitting a quiz files an attempt; handing in homework is final; a parent's
  message reaches a real tutor. Know what a test will write before running it.
- **Credentials are not kept in this repository.** Ask Ali. Never commit them,
  and never paste them into a doc, a test or a script.

A feature with no real data to show yet (no target grades set, no session
scheduled) is **untested**, not tested in the showcase. Create the data on the
test accounts, or say it's untested.

## Source of truth: `src/lib/auth/session.ts` and `src/lib/auth/guardState.ts`

```ts
type AuthMode = "live" | "anonymous";

interface AuthSession {
  mode: AuthMode;
  user: User | null; // the Supabase user, when signed in
}

getAuthSession(): Promise<AuthSession> // validates the session with the server
getSessionUserId(): Promise<string | null> // local session, no network — for scoping queries
isDemoMode(): boolean // true under /demo/* — derived from the pathname
getDemoRole(): "student" | "parent" | null
```

- `getAuthSession()` calls `supabase.auth.getUser()`, which validates the token
  against the Auth API. If the Auth API **cannot be reached**, the locally held
  session stands in, so a dropped connection doesn't throw a signed-in student to
  the login page. A token the server has actually rejected still resolves to
  anonymous.
- `isDemoMode()` is derived from the URL, so it cannot be left on by a stale
  flag and cannot bleed into a real session.

### The viewer

`guardState.ts` resolves **who the caller is, once**: their profile role, their
staff grants in `user_roles`, and (students only) `my_access_state()`. The answer
is cached for a minute, re-asked when stale, and a failed read falls back to the
last good answer instead of being cached as "student" or "hasn't paid".

```ts
interface GuardState {
  userId: string;
  role: string | null; // profiles.role; null = could not be read
  appRole: UserRole; // what the app routes on — staff grants win
  onboardingComplete: boolean | null; // null = unanswered, never "no"
  hasAccess: boolean | null;
}
```

The guard puts it on the route context as `viewer`. Everything below reads it
from there and **nothing asks the network who the caller is again**:

- Route guards — `guardStudentSection`, `guardStudentHome`, `guardParentOnly`
  in `src/lib/auth/routeGuards.ts` — read `context.viewer`. So does
  `roleHomePath`, which `/dashboard` renders a `<Navigate>` to. It must not
  redirect from `beforeLoad`: a guard slower than the router's one-second
  pending delay has already put the match on screen, and this router version
  renders a redirected match by throwing `undefined`, which blanks the page.
- Components use `useViewer()` / `useViewerId()` from `src/hooks/useViewer.ts`.
  Both return null in the showcase.

## Route protection

`src/routes/_authenticated/route.tsx` guards every `/_authenticated/*` route in
`beforeLoad`:

```ts
const session = await getAuthSession();
if (!session.user) throw redirect({ to: "/auth", search: { redirect: location.href } });
const guard = await loadGuardState(context.queryClient, session.user.id);
// students only: onboarding redirect, then the paywall overlay
return { session, locked, viewer: guard };
```

Server functions are separately protected by `requireSupabaseAuth`
(`src/integrations/supabase/auth-middleware.ts`), which validates the Bearer
token via `getClaims` before running privileged server logic.

## Sign-up → profile setup → payment

Sign-up is only "who are you". `handle_new_user` creates the profile, the role
and the invite code — and grants **nothing** else. It used to enrol the student
and write a `trialing` subscription straight from sign-up metadata, which handed
out access before anyone paid; that is exactly what the paywall exists to stop.

What you study, and whether you've paid for it, is settled after the email is
verified, in `/onboarding/*`:

1. `board` — level + exam board
2. `subjects` — subjects, with a per-subject board override; **writes the
   enrolments**
3. `learning` — pedagogy sliders (optional)
4. `school` — school + per-subject grades (optional); **marks setup complete**
5. `plan` — Stripe Checkout, or invite a parent to pay

These routes sit **outside** `/_authenticated` on purpose: that guard redirects
unpaid students _to_ them, so nesting them under it would loop.

### Google and Microsoft

The sign-in page offers "Log in / Sign up with Google" and "…with Microsoft"
(Supabase's `azure` provider) under the email form. A button only shows when
its provider is switched on in Supabase Auth, so turning a provider off hides it.

The provider sends back its own profile, never our form's fields, so:

- `handle_new_user` takes the display name from the provider's `full_name` /
  `name`, then the email prefix.
- Every SSO account is created as a **student**. A visitor who picked "Parent"
  first has that choice, their child's invite code and any pricing-page plan
  remembered in the browser (`src/lib/auth/ssoIntent.ts`). On return to `/auth`
  the app calls `claim_parent_role()`, then `link_child_by_code()`.
  `claim_parent_role()` only acts on an SSO account under 30 minutes old that
  has done nothing as a student, and only ever moves student → parent.
- No email code step: the provider has verified the address.

Setup, once per provider:

1. **Google:** Google Cloud Console → APIs & Services → Credentials → OAuth
   client ID (Web). Authorised redirect URI:
   `https://peohauhwquuvghrpmotf.supabase.co/auth/v1/callback`. Set the consent
   screen's app name and logo.
2. **Microsoft:** portal.azure.com → Microsoft Entra ID → App registrations →
   New registration, "any organisational directory and personal Microsoft
   accounts", Web redirect URI as above. Create a client secret and note its
   expiry date. Add the `xms_edov` and `email` optional claims (Manifest →
   `optionalClaims`) so Supabase can tell a verified email from an unverified one.
3. **Supabase:** Authentication → Sign In / Providers → enable each, pasting the
   client ID and secret. Authentication → URL Configuration → Redirect URLs must
   allow `/auth` on every origin (production and `http://localhost:*/**`), or
   the provider sends the visitor to the Site URL and their choices aren't
   applied.

## The paywall

`/_authenticated` asks three questions in order — session, then (students only)
setup complete, then access:

```ts
if (guard.appRole === UserRole.STUDENT) {
  if (guard.onboardingComplete === false) throw redirect({ to: "/onboarding/board" });
  locked = guard.hasAccess === false && !location.pathname.startsWith("/billing");
}
```

- **Only a definite `false` moves anybody.** `null` means the access check went
  unanswered. Treating that as "no" used to throw a paying student back to step
  one of setup whenever a read timed out.
- **An unpaid student is not redirected.** The page still renders and a frosted
  `PaywallOverlay` is drawn over it. `/billing` is exempt, so a student who
  paused their own plan can get back in to resume it.

Setup and access are asked of **students only**. Parents and tutors have nothing
to buy for themselves and `my_access_state()` answers `false` for them, so
applying it to everyone would lock every tutor out of their own app.

Access itself is `private.student_has_access(student_id)`: a subscription
covering _that student_, `active` or `trialing`, still inside its period. A
subscription names the student it covers (`student_id`) separately from who pays
for it (`user_id`), so a parent can fund a child without either of them being
mistaken for the other.

> **The overlay is presentation. RLS is the paywall.** Curriculum content
> (topics, spec_points, resources, mcq_*, weekly_focus) is gated in RLS by
> `private.viewer_has_content_access()`, so a lapsed student with their own JWT
> reads nothing from those tables either. Expect content queries to come back
> **empty**, not errored, when `locked` is true. A lapsed student keeps read
> access to their own records, billing and profile, by design.

See [STRIPE_SETUP.md](STRIPE_SETUP.md) for the Stripe half.

## Tutors are never students

A tutor or admin account holds no student data at all. The database enforces
this (`supabase/migrations/20261003115242_tutors_are_never_students.sql`), so it
holds for the app, edge functions, scripts and hand-written SQL alike:

- **No student row may name a tutor.** Every table holding a student's own data
  (enrolments, learning profile, plans, reviews, quiz attempts, homework,
  subscriptions, parent links and the rest) carries the trigger
  `student_row_not_staff`. A new student table goes on the list in that
  migration.
- **A tutor's profile has no level, no courses and no invite code.**
- **The profile follows the grant.** Changing a `user_roles` row to `tutor`
  makes the profile a tutor profile. A profile can't claim `tutor` without the
  grant, and a tutor can't also hold `student`.
- **Promotion is refused while the account still holds student data.** Nothing
  is deleted automatically, so promoting the wrong account can't wipe a
  student's history.

The app matches it. A tutor who opens a quiz gets a preview with no Submit, and
the planner's fill-in generators (`ensureMcqForPoints`,
`ensureHomeworkForPoints`) refuse staff callers.

**To make a student a tutor**, run:

```sql
update public.user_roles set role = 'tutor' where user_id = '<id>' and role = 'student';
```

If it is refused, the error names the tables still holding their rows. Delete
those rows, clear `profiles.level` and `profiles.enrolled_courses`, and run it
again.

**To take tutor access away**, delete their tutor row in `user_roles`, then set
`profiles.role` to what they now are. Give them a `student` row if they study.
A former tutor has no invite code: set one with
`public.gen_student_invite_code()` if a parent needs to link.

## Environment configuration

Session/URL/keys come from environment variables (`.env`, see `.env.example`) —
never hardcoded. `SUPABASE_SERVICE_ROLE_KEY` is server-only and must never reach
the client bundle.
