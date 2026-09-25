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
student:

- **Account:** `123@123.com`
- **Designed for testing.** It has no active card, so nothing can be charged.
- **It is a real student on the live project, so its writes are real.** Submitting
  a quiz files an attempt; handing in homework is final. Know what a test will
  write before running it.
- **Credentials are not kept in this repository.** Ask Ali. Never commit them,
  and never paste them into a doc, a test or a script.

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

- Route guards — `guardStudentSection`, `redirectToRoleHome`, `guardStudentHome`,
  `guardParentOnly` in `src/lib/auth/routeGuards.ts` — read `context.viewer`.
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

## Environment configuration

Session/URL/keys come from environment variables (`.env`, see `.env.example`) —
never hardcoded. `SUPABASE_SERVICE_ROLE_KEY` is server-only and must never reach
the client bundle.
