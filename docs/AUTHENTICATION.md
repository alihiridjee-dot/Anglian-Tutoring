# Authentication & Session Management

This document describes how the app distinguishes an **Authenticated Live User**
from **Demo Mode**, and how protected routes are guarded.

## Principles

1. **Every signed-in state is a real Supabase session.** There is no client-side
   "bypass" flag that grants access. Both live and demo users authenticate
   against Supabase Auth and receive a real JWT.
2. **Data isolation is enforced server-side by Row-Level Security (RLS)** — never
   by hiding data in the frontend. The demo account only _receives_ the data it
   is entitled to.
3. **The demo flag is a UI hint only.** It controls banners and cosmetic demo
   visuals; it does not grant or gate access to data.

## The two environments

|                                          | Authenticated Live User     | Demo Mode                                                              |
| ---------------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| Session                                  | Real Supabase session       | Real Supabase session (dedicated demo account)                         |
| Account                                  | The user's own account      | `demo.student@angliantutoring.app` / `demo.parent@angliantutoring.app` |
| How you enter                            | `/auth` sign in / sign up   | `/demo` → "Explore …" (calls `enterDemoMode`)                          |
| Curriculum (topics, spec points, videos) | Full, for enrolled subjects | Full (all subjects)                                                    |
| MCQs                                     | All published               | Exactly one pinned set (`mcq_sets.demo_visible`)                       |
| Homework                                 | All (enrolled)              | Exactly one pinned item (`resources.demo_visible`)                     |
| Live sessions                            | All (enrolled)              | None                                                                   |
| Enforcement                              | RLS on `is_enrolled_in`     | RLS on `private.is_demo_user()` + `demo_visible`                       |

The demo restrictions live in `supabase/migrations/20260709100000_demo_access_model.sql`.

## Source of truth: `src/lib/auth/session.ts`

All auth/demo state flows through one typed module. Do **not** read the demo
`localStorage` keys directly anywhere else.

```ts
type AuthMode = "live" | "demo" | "anonymous";

interface AuthSession {
  mode: AuthMode;         // which environment
  user: User | null;      // the Supabase user (present for live AND demo)
  isDemo: boolean;        // true only in the sandbox
  demoRole: DemoRole | null; // "student" | "parent" when isDemo
}

getAuthSession(): Promise<AuthSession>  // validates the session with the server
isDemoMode(): boolean                   // UI hint
getDemoRole(): DemoRole | null
markDemoSession(role)                   // called after a demo sign-in
clearDemoSession()                      // called on "Exit sandbox" / "Join now"
```

- `getAuthSession()` calls `supabase.auth.getUser()`, which validates the token
  against the Auth API — it does not trust local storage alone.
- `isDemo` is only ever `true` when there is **also** a real user, so a leftover
  demo flag with no session resolves to `mode: "anonymous"`.

## Route protection

`src/routes/_authenticated/route.tsx` guards every `/_authenticated/*` route in
`beforeLoad`:

```ts
const session = await getAuthSession();
if (!session.user) throw redirect({ to: "/auth", search: { redirect: location.href } });
return { session }; // typed AuthSession on route context
```

Because demo mode is a real session, the guard is uniform: live and demo both
pass; anonymous (or stale-flag-without-session) is redirected to `/auth`.

Server functions are separately protected by `requireSupabaseAuth`
(`src/integrations/supabase/auth-middleware.ts`), which validates the Bearer
token via `getClaims` before running privileged server logic.

## Sign-up → plan enrolment

`/auth` sign-up passes `signup_tier` and `signup_level` in the user metadata.
The `handle_new_user` trigger
(`supabase/migrations/20260709110000_signup_enrolment.sql`) then:

- creates the profile + `student` role + invite code,
- enrols the student in the plan's subjects (`enrolled_courses`), and
- records the chosen plan on a `subscriptions` row (`status = 'trialing'`).

> Payment is not yet integrated — enrolment is granted on sign-up. When Stripe is
> added, gate enrolment on `subscriptions.status` rather than on sign-up.

## Environment configuration

Session/URL/keys come from environment variables (`.env`, see `.env.example`) —
never hardcoded. `SUPABASE_SERVICE_ROLE_KEY` is server-only and must never reach
the client bundle.
