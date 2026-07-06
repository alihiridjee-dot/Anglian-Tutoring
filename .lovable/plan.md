Full rebrand + rebuild to **Anglian Tutoring**. Big scope — I'll execute in phases and pause at the ones that need your input (Stripe form, WhatsApp number).

## Phase 1 — Brand, landing page, auth flow

- **Rename** to Anglian Tutoring throughout (titles, meta, sidebar, README).
- **Light theme only**: rewrite `src/styles.css` tokens to a clean light palette. Blues (primary) + Greens (secondary/accent). Delete dark tokens.
  - Primary Blue `#1D4ED8` (RGB 29,78,216), light `#DBEAFE`, deep `#1E3A8A`
  - Accent Green `#059669` (RGB 5,150,105), light `#D1FAE5`
  - Neutral surfaces `#FFFFFF`, `#F8FAFC`, text `#0F172A`
  - Values also written to a new `README.md` under a "Theme tokens" section.
- **Public landing page at `/`** — replace current auto-redirect. Sections: Hero, About Us (Nadia & Ali bios), What We Offer, Pricing tiers (KS3, GCSE single-subject, GCSE triple science, AQA Trilogy), Contact form (writes to new `leads` table), footer with prominent phone number. Nav has **Login** and **Sign Up** buttons top-right. Floating **WhatsApp** chat button bottom-right (I'll ask for your number when we get here — placeholder `+44` link until then).
- **Sign-up flow** replacing the current `/auth`: student picks Level (KS3 / GCSE) → picks package (single subject / triple science / AQA Trilogy) → account details → Stripe Checkout. On successful payment the webhook flips their subscription active and auto-populates `enrolled_courses`. Parent signup accepts an **invite code** to link to a student.
- **Sign out** navigates back to `/` (landing page).
- **Demo bypass**: kept as a small `?demo=1` shortcut on `/auth` — not linked from anywhere public.

## Phase 2 — Dashboard shell & navigation

- **Sidebar** rebuilt with exactly: Dashboard, Curriculum, Homework & Grades, Live Sessions, Billing, MCQs. (Tutor-only extra: Tutor Studio, Students.)
- **Header** gets **Back / Forward** buttons wired to `router.history.back()` / `.forward()` plus a subject switcher pill.
- Preview-as-student toggle stays for tutors.

## Phase 3 — Database migration (single migration)

- `profiles`: add `role` enum (`tutor`/`student`/`parent`), `enrolled_courses text[]`, `parent_of uuid[]`, `student_invite_code text unique`, `phone`.
- New `leads` (contact form).
- New `packages` (KS3/GCSE tiers → subject arrays → Stripe price IDs).
- `subscriptions` extended with `tier`, `stripe_price_id`, `current_period_end` (already there).
- `homework_submissions` (student_id, resource_id, file_path, submitted_at, grade, feedback, graded_by).
- `mcq_attempts` already exists — add `week_number` on `mcq_sets`.
- **Indexes** on `resources.subject`, `mcq_attempts(user_id, set_id)`, `homework_submissions(student_id, resource_id)`, `subscriptions.user_id`, `session_attendees(resource_id)`.
- **RLS lockdown**:
  - `resources` SELECT policy checks `resources.subject = ANY(profile.enrolled_courses)` for students. Tutors bypass.
  - `homework_submissions`: student reads/writes their own; tutor reads/updates all.
  - `mcq_attempts` / `mcq_sets`: student can only see sets whose parent topic's subject is in their enrolments.
  - `profiles`: parent can SELECT rows in their `parent_of` list.
- Auto-confirm email stays **on** so signups work without DNS.

## Phase 4 — Feature builds (custom hooks pattern)

All Supabase queries move into `src/hooks/data/*` — one hook per domain (`useEnrolments`, `useCurriculum`, `useHomework`, `useSubmissions`, `useMCQs`, `useAttempts`, `useSubscription`, `useLeads`). Strict TS, no `any`.

- **Curriculum** page: existing spec-point browser, but list of subjects is filtered by the student's enrolments. Tutor sees everything.
- **Live Sessions**: card grid with thumbnail (subject-tinted), clock icon + start time, Join button (Teams URL). Access enforced by subject enrolment. Attendance recorded on click.
- **Homework & Grades**:
  - Tutor sets a homework brief (title, instructions, spec point, subject). **No downloadable task file** — students see the brief in-app.
  - Student upload section (multi-file: PDF/DOCX/PNG/JPG) into `resources` storage → row in `homework_submissions`.
  - Tutor grading view: submissions table, inline grade + feedback textarea.
  - Grade dashboard for student: chart of past grades + MCQ scores. **Grade Predictor**: rolling weighted average (last 5 attempts × 0.7 + last 5 homework × 0.3) mapped to GCSE grades 1–9 via a simple lookup. Predicted grade shown per subject.
  - Parent view: same data for each linked child.
- **MCQs** tab (dedicated route):
  - Tutor: pick spec point → "Generate weekly quiz" (AI, Gemini) or paste JSON → preview → Publish. Weekly = `week_number` auto-incremented per subject.
  - Student: card grid of published quizzes for their subjects, filter by week. Click → interactive quiz (already built at `/mcq/$setId`) → instant score + explanations → saved to `mcq_attempts`.
- **Billing** page: shows current plan, next renewal, "Manage subscription" (Stripe portal), and package upgrade options.

## Phase 5 — Stripe (needs your input)

- Run payment eligibility check → enable Lovable's built-in Stripe payments → I'll ask you to fill the enable form.
- Create products & prices:
  - KS3 Science £X/mo
  - GCSE Single Subject £X/mo
  - GCSE Triple Science £X/mo
  - AQA Trilogy £X/mo
    (I'll ask you for exact prices before creating.)
- Checkout on signup + webhook at `/api/public/webhooks/stripe` → updates `subscriptions` and `enrolled_courses`.

## Phase 6 — Teams integration (already scaffolded)

- I'll trigger the Microsoft Teams connector connection when we reach this phase; you authorize with a Microsoft 365 account. Meetings created via Graph, join URL saved on the live-session resource.

## What I'll skip (until you ask)

- Custom email domain (auto-confirm covers it).
- Parent multi-child bulk management UI beyond linking (add later if you want).
- Native mobile app.

## Order of execution

1. Phases 1–4 in one big build (bulk of the work, no external dependencies).
2. Pause → **you fill the Stripe enable form** → Phase 5.
3. **You authorize Microsoft** → Phase 6.
4. **You give WhatsApp number** → drop it into the floating button.

Approve and I'll start with phase 1.
