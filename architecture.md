# Application Architecture

This document tracks the file tree, state management paradigm, core API/backend structures, and key architectural flows for Anglia Educate.

For authentication & the live/demo session model, see [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md).

---

## 📂 File Tree

```text
.
├── AGENTS.md                  # Custom agent instructions & safety guardrails
├── README.md                  # Developer instructions and project overview
├── docs/
│   ├── AUTHENTICATION.md      # Session model, guard, sign-up → setup → paywall
│   └── STRIPE_SETUP.md        # Seeding products, deploying the webhook, going live
├── scripts/
│   └── stripe-seed.ts         # Creates Stripe products/prices → packages.stripe_price_id
├── supabase/
│   ├── config.toml            # Supabase project link (project_id)
│   ├── functions/
│   │   ├── stripe-checkout/   # Checkout + billing-portal sessions (price read server-side)
│   │   └── stripe-webhook/    # THE only writer of subscriptions — grants/revokes access
│   └── migrations/            # Canonical schema — applied in order via db push
├── components.json            # Configuration for UI components (Shadcn UI)
├── eslint.config.js           # Linting configuration
├── package.json               # Dependencies, build, and start scripts
├── tsconfig.json              # TypeScript compilation setup
├── vite.config.ts             # Vite/TanStack build-time plugins configuration
└── src/
    ├── components/            # UI Components
    │   ├── AppLayout.tsx      # Main wrapper template for authenticated pages
    │   ├── UserMenu.tsx       # Header avatar dropdown (profile/dashboard/parents/sign out)
    │   ├── CurriculumSyncPanel.tsx # Tutor-only curriculum text/PDF importer
    │   ├── FilterBar.tsx      # Subject/Board/Level interactive filters
    │   ├── CourseBadge.tsx    # Header chip: the level + board this student sits
    │   ├── chat/              # Thread list, conversation view, compose + context picker
    │   ├── landing/           # Landing page component modules
    │   ├── tutor/             # Tutor management forms
    │   └── ui/
    │       └── chart.tsx      # Recharts wrapper (only design-system primitive in use)
    │
    ├── hooks/                 # Custom React hooks
    │   ├── data/              # Query-bound data hooks
    │   │   ├── useAnalytics.ts
    │   │   ├── useBilling.ts       # Plans, subscriptions, useOwnPlanState (resumable?)
    │   │   ├── useChat.ts          # Threads, messages, unread badge (polled)
    │   │   ├── useEnrolments.ts
    │   │   └── useParentLinks.ts   # Parent<->student link lifecycle (RPC-backed)
    │   ├── useSignOut.ts      # Shared sign-out teardown (cancel → clear → signOut)
    │   └── useRole.ts         # Authentication role state cache
    │
    ├── integrations/
    │   └── supabase/          # Supabase client, auth attacher & middleware
    │       ├── auth-attacher.ts    # Attaches bearer token to serverFn RPCs
    │       ├── auth-middleware.ts  # requireSupabaseAuth for server functions
    │       ├── client.ts           # Browser/SSR client (publishable key)
    │       └── types.ts            # Generated DB types (supabase gen types)
    │
    ├── lib/
    │   ├── auth/session.ts    # Typed AuthSession — single source of truth for live/demo
    │   ├── authService.ts     # Role resolution + effective student id
    │   ├── chatDal.ts         # Data access layer — student<->tutor threads/messages
    │   ├── chatDraft.functions.ts # Server fn: AI draft of a tutor reply (tutor-only)
    │   ├── courseSummary.ts   # Level/board/subject labels — the ONLY place they're spelled
    │   ├── curriculumDal.ts   # Data access layer — ALL curriculum reads (DB only)
    │   ├── curriculumSyncService.ts # Parses spec text → inserts topics/points/MCQ sets
    │   ├── demo/studentDemo.ts # Showcase fixtures — no account, no session
    │   ├── error-capture.ts   # Catastrophic SSR error reporting bounds
    │   ├── rateLimit.ts       # In-memory sliding window, for endpoints with no caller
    │   ├── whatsapp.ts        # The public WhatsApp number + wa.me links
    │   ├── whatsappLead.functions.ts # Server fn: demo sales chat → leads + WhatsApp
    │   ├── error-page.ts      # Fail-safe SSR error layout page
    │   ├── mcq.functions.ts   # Server fn: AI MCQ generation (tutor-only)
    │   ├── taxonomy.ts        # Subjects, boards, levels
    │   ├── validation.ts      # Dependency-free field validators for account forms
    │   └── utils.ts           # Classnames merging utility
    │
    ├── routes/                # File-based routing (TanStack Start)
    │   ├── __root.tsx         # Global base wrapper (meta tags, Toaster)
    │   ├── auth.tsx           # Login/signup — identity only (honours ?redirect=)
    │   ├── demo/              # Public showcase — thin wrappers, fixtures, no session
    │   ├── how-it-works.tsx   # The services + FSRS explainer (live engine, not art)
    │   ├── index.tsx          # Public landing page
    │   ├── reset-password.tsx
    │   ├── onboarding/        # Profile setup + paywall — OUTSIDE _authenticated
    │   │   ├── route.tsx      # Guard: session required, access NOT required
    │   │   ├── board.tsx · subjects.tsx · learning.tsx
    │   │   └── school.tsx · plan.tsx
    │   └── _authenticated/    # Guarded routes (valid session required)
    │       ├── route.tsx      # AuthGuard — validates session, exposes AuthSession
    │       ├── billing.tsx · curriculum.tsx · dashboard.tsx · downloads.tsx
    │       ├── homework.tsx · live.tsx · mcqs.tsx · mcq.$setId.tsx · notes.tsx
    │       ├── messages.tsx   # Student<->tutor chat; one route, branches on role
    │       ├── parent-dashboard.tsx · parents.tsx · profile.tsx
    │       ├── settings.tsx · student-dashboard.tsx
    │       └── students.tsx · tutor.tsx · videos.tsx
    │
    ├── routeTree.gen.ts       # Autogenerated routing map
    ├── router.tsx             # TanStack Router configuration
    ├── server.ts              # Production SSR handler (Nitro)
    ├── start.ts               # Boot module (registers auth attacher middleware)
    ├── styles.css             # Tailwind v4 stylesheet
    └── types/user.ts          # UserRole enum
```

---

## ⚙️ State Management Paradigm

1. **Server State (Supabase + React Query)** — all data fetches are query caches;
   mutations invalidate keys for seamless refetches. No curriculum, resource, MCQ,
   or homework content exists in code — **the database is the single source of
   truth** and everything is fetched at runtime through `CurriculumDAL` or
   direct scoped queries.
2. **Routing State (TanStack Router)** — transitions, query-string state
   (login modes, pricing plans), and auth-guard redirects.
3. **Local UI/Form State (React state)** — ephemeral UI properties.

## 🔐 Data access model (summary)

- **There is no demo account.** `/demo/*` is a session-less showcase: the real
  page components mounted outside the guard, with every data path
  short-circuiting to fixtures in `lib/demo/studentDemo.ts`. `isDemoMode()`
  derives from the pathname, so it cannot be left on by a stale flag. The
  `is_demo` / `demo_visible` columns were dropped in 2026-07; don't bring them
  back.
- **Row-Level Security is the enforcement layer**, and it is the only one.
  Guards and `enabled:` flags shape the UI; they are not access control.
- **Sign-up grants nothing** — no enrolment, no subscription, and (since
  2026-08-07) no role beyond `student`. `raw_user_meta_data.role` is a
  self-declared *profile* role limited to student/parent; `user_roles`, which is
  what every policy consults, is never written from it. Staff access is granted
  out of band.
- **Identity columns are not the user's to write.** `authenticated` holds
  UPDATE on `profiles` only for display_name, phone, school, level and the
  onboarding stamp. `role`, `student_invite_code` and `enrolled_courses` are
  revoked — the last of those *is* the subject scope of the content policies, so
  a writable copy was a paywall bypass. `save_student_enrolments` is the single
  writer and is SECURITY DEFINER for that reason.
- **Scores are written by the grader, not the client.** `mcq_attempts` has no
  INSERT/UPDATE grant for `authenticated`; `grade_mcq_attempt` marks server-side
  against the stored answer key. `homework_submissions` has the equivalent guard
  as a trigger (`enforce_grading_privileges`).
- Board, subjects and payment are captured in `/onboarding/*`, and
  `/_authenticated` gates students on `my_access_state()`. See
  [docs/STRIPE_SETUP.md](docs/STRIPE_SETUP.md).

## 👪 Parent linking

Two tables, and the split between them is load-bearing:

- **`parent_student_links`** means an **active** relationship, and nothing else.
  Four policies — `profiles` ("profiles parent reads linked"),
  `homework_submissions` ("hs read scoped"), `resources` ("resources read
  scoped") and `storage.objects` ("resources bucket read scoped") — treat a row
  here as proof the parent may read that child's data. None of them filter on a
  status, so **never add a pending/inactive row to this table**: it would grant
  access, not request it.
- **`parent_link_invites`** holds pending invites, addressed to an *email* (the
  invitee may have no account yet). It grants nothing on its own.

Writes go through SECURITY DEFINER RPCs, since `authenticated` has SELECT only
on the invites table: `invite_parent_by_email` (student → pending invite),
`respond_to_parent_invite` (parent accepts → the single non-tutor write to
`parent_student_links`), `revoke_parent_invite`, and `unlink_parent` (either
side ends a link; RLS otherwise permits DELETE to tutors only).

Invite codes (`profiles.student_invite_code`) are redeemed two ways.
`handle_new_user` consumes `raw_user_meta_data.parent_invite_code` at sign-up,
and `link_child_by_code` lets an *existing* parent redeem one afterwards. Codes
are CSPRNG-drawn Crockford base32 (~40 bits) via `gen_student_invite_code`, and
`rotate_student_invite_code` lets a student invalidate a leaked one without
disturbing existing links.

> An earlier version of this document claimed there was no post-sign-up
> redemption RPC and that this made codes un-brute-forceable. `link_child_by_code`
> exists, so the second half of that claim rests on the code's 40 bits of entropy
> alone: guessing one is ~10¹² attempts, which is out of reach over HTTP, but
> **the RPC is not rate limited**, and it distinguishes `not_found` from
> `already_linked`. If the code length is ever shortened, or a bulk-attempt
> pattern shows up in the logs, add a throttle before doing anything else — a
> successful guess links a stranger to a child's account and all their work.

## 🌐 Core API & Backend Integration

- **SSR entry (`src/server.ts`)** — proxies requests to TanStack Start, catches
  server-side failures with a clean fallback error page.
- **Server functions** — protected by `requireSupabaseAuth` (bearer-token
  validation); the client attaches tokens via `attachSupabaseAuth` in `start.ts`.
- **Supabase** — Auth (email/password), RLS-secured Postgres, and a private
  `resources` storage bucket for homework uploads and downloads.
