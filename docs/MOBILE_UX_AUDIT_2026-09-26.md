# Mobile UX audit and refactor — 2026-09-26

A file-by-file pass over every client route, layout and reusable component
for phone usability (375–390px, touch). Every defect found was fixed in place
with class- or attribute-level edits; no business logic, queries, copy or
branding changed, no files renamed. Verified in the browser at 375×812 on the
test student account (`123@123.com`) for every student-facing page, and on
the public pages. Tutor-only screens were fixed by inspection and type-check
only: there is no tutor test account to sign in with.

Standards applied: no horizontal bleed; 44px tap targets on phones (kept
compact from `sm` up); 16px form text on touch screens; correct mobile
keyboards and autocomplete; labels wired to controls; scroll-locked dialogs
and drawers with backdrop/Escape close and a viewport-bounded panel; safe-area
padding on anything that reaches the bottom edge; `p-4` gutters on phones.

## Shell and kit (root layer)

- `src/routes/__root.tsx` — Issue: safe-area insets never resolved — Change: `viewport-fit=cover` on the viewport meta.
- `src/styles.css` — Issue: no page-level guard against sideways scroll; no notch padding; iOS zoomed on every `text-sm`/`text-xs` field; tab segments 36px on touch; no way to enlarge a compact control's hit area; dialog scrims (`bg-primary-deep/50`, used by seven dialogs) compiled to nothing because the token was never registered — Change: new MOBILE section: `html { overflow-x: hidden }`, body safe-area side padding, unlayered 16px rule for small-set fields on `(pointer: coarse), (max-width: 40rem)`, `.tab-item { min-height: 2.75rem }` on touch, `.tap-target` (44×44 `::after` hit area, `position: relative` in the components layer), `.tab-row-fluid` (≤4 segments share the width and wrap on phones); `--color-primary-deep` registered in `@theme`.
- `src/components/AppLayout.tsx` — Issue: the hover-expanding icon rail can never show labels on touch and eats 80px of a 375px screen; header buttons 36px; `px-6`/`p-6` gutters; page content was an `overflow-auto` box, so `sticky` inside pages never worked — Change: below `md` the rail is a fixed slide-in drawer (hamburger in the header, tap-to-close scrim, Escape, close on navigation, body scroll lock, `invisible` when closed so it leaves the tab order, safe-area bottom padding); nav rows `min-h-11`; header `size-11` menu/back buttons (forward waits for `sm`), `px-4`, truncating title; content `p-4` with safe-area bottom and `overflow-x-clip` (sticky now works against the viewport).
- `src/components/sidebarLabel.ts` — Issue: labels were opacity-0 until hover — Change: `max-md:opacity-100`.
- `src/components/search/SidebarSearchButton.tsx` — Issue: 40px row; ⌘K hint shown on phones — Change: `min-h-11`; `kbd` hidden below `md`.
- `src/hooks/useBodyScrollLock.ts` — New: the one scroll lock every drawer and dialog now uses.
- `src/components/landing/Nav.tsx` — Issue: the five section links vanished below `md` with no replacement; wordmark + three buttons overflowed a 375px bar; "Sign up" wrapped to two lines — Change: hamburger sheet (section links + Login, 44px rows, scrim, scroll lock, Escape, closes on navigation); Login moves into the sheet below `sm`; `whitespace-nowrap` and tighter phone gutters so the bar fits a 360px phone.
- `src/components/landing/FloatingWhatsApp.tsx` — Issue: sat under the home indicator — Change: `bottom-[calc(1.25rem+env(safe-area-inset-bottom))]`.
- `src/components/NotificationBell.tsx` — Issue: 36px button; 320px popover could exceed the viewport; "Mark all read" ~16px — Change: `size-11 sm:size-9`; popover `w-[min(20rem,calc(100vw-2rem))]`, `max-h-[min(24rem,70dvh)]`; `min-h-11`.
- `src/components/UserMenu.tsx` — Issue: 36px avatar button; menu items 36px — Change: `p-1 -m-1` (44px hit area); items `min-h-11`; menu `max-w-[calc(100vw-2rem)]`.
- `src/components/search/GlobalSearchDialog.tsx` — Issue: 15px input (iOS zoom); 24px close; `pt-[10vh]` wasted phone height — Change: `text-base`; `tap-target`; phone `p-3` with safe-area top; result rows `min-h-11`; `60dvh` list.
- `src/components/StudentGuide.tsx` — Issue: trigger and step buttons 39px — Change: `min-h-11 sm:min-h-0`.
- `src/components/Shared.tsx` — Issue: a segmented toggle wider than the phone scrolled with its first segment cut off — Change: `tab-row-fluid` on toggles of up to four segments.
- `src/components/tutor/Field.tsx` — Issue: shared inputs 40px on phones; `<label>` not wired to its control (profile, parents, delete-account) — Change: `h-11 sm:h-10`; label `htmlFor` the first `input`/`select`/`textarea` child via `useId`.

## Public site and onboarding

- `src/routes/reset-password.tsx` — Issue: password inputs lacked autocomplete and label association; submit 40px — Change: `autoComplete="new-password"`, `id`/`htmlFor`; `h-11 sm:h-10`.
- `src/routes/our-story.tsx` — Issue: `px-6` gutters; timeline card too narrow at 375; CTA card `px-8 py-14` — Change: `px-4 sm:px-6`; `gap-4 sm:gap-6`, `min-w-0 flex-1 p-5 sm:p-6`, rule `left-[2.75rem] sm:left-[3.25rem]`; `px-5 py-10 sm:px-14 sm:py-14`.
- `src/routes/how-it-works.tsx` — Issue: `px-6` gutters; hero CTAs 41px; CTA card `px-8 py-14` — Change: `px-4 sm:px-6`; `min-h-11`; `px-5 py-10 sm:px-14 sm:py-14`.
- `src/routes/onboarding/route.tsx` — Issue: six 11px step labels truncated to ~50px each — Change: inactive labels `max-sm:sr-only` (dots + current step's full label on phones).
- `src/routes/onboarding/learning.tsx` — Issue: range sliders ~20px hit area; labels not associated — Change: `h-11`; `id`/`htmlFor`.
- `src/routes/onboarding/board.tsx` — Issue: level tiles 2-col and board tiles 3-col overflowed their text — Change: `grid-cols-1 sm:grid-cols-2`; `grid-cols-2 sm:grid-cols-3`.
- `src/routes/onboarding/subjects.tsx` — Issue: board `<select>` 32px, unlabelled; row overflowed — Change: `h-11 sm:h-8`, `aria-label`, `flex-wrap`.
- `src/routes/onboarding/school.tsx` — Issue: school input lacked type/autocomplete/label; grade selects 36px, unlabelled — Change: `type="text" autoComplete="organization"`, `id`/`htmlFor`; `h-11 sm:h-9`, `aria-label`.
- `src/routes/onboarding/plan.tsx` — Issue: `p-10` card; text buttons ~16px — Change: `p-6 sm:p-10`; `min-h-11 sm:min-h-0`.
- `src/components/onboarding/StepCard.tsx` — Issue: footer (Back + Skip + Continue) overflowed at 375 and the CTA sat out of the thumb zone — Change: `flex-wrap`; phone-only sticky footer (`bg-card/90 backdrop-blur`, safe-area padding), full-width Continue.
- `src/components/onboarding/PlanStepParts.tsx` — Issue: `p-10` cards; tiny "Sign out"/"Edit subjects"; cadence tiles tight; parent email placeholder-only — Change: `p-6 sm:p-10`; `min-h-11` / `tap-target`; `min-w-0 p-2 sm:p-3`; `inputMode="email" autoComplete="email" aria-label`, `min-w-0`.
- `src/components/landing/Hero.tsx` — Issue: `px-6` — Change: `px-4 sm:px-6`.
- `src/components/landing/TutorsSection.tsx` — Issue: `px-6`; cards `p-8`; chat modal had no scroll lock/Escape, 36px close, `90vh`, non-shrinking chat pane — Change: `px-4 sm:px-6`; `p-5 pt-8 sm:p-8 sm:pt-10`; `useBodyScrollLock`, Escape, `size-11 sm:size-9`, `max-h-[calc(100dvh-2rem)]`, `min-h-0`.
- `src/components/landing/OfferSection.tsx` — Issue: `px-6`; `p-7`/`p-6` cards — Change: `px-4 sm:px-6`; `p-5 sm:p-8` / `p-5 sm:p-6`.
- `src/components/landing/PricingSection.tsx` — Issue: tiers `grid-cols-3` at 375; `px-6`; slider segments 36px with crushed labels; Continue/Enrol 40px — Change: `grid-cols-1 sm:grid-cols-3`; `px-4 sm:px-6`, `px-5 … sm:px-6`; `min-h-11 px-2 leading-tight`; `min-h-11 sm:min-h-0`.
- `src/components/landing/ContactSection.tsx` — Issue: `px-6`; `p-8`; inputs lacked autocomplete/label association; contact rows 40px — Change: `px-4 sm:px-6`; `p-5 sm:p-8`; `autoComplete` name/email/tel + `id`/`htmlFor`; `min-h-11`, email `break-all`.
- `src/components/landing/Footer.tsx` — Issue: `px-6`; nav links ~20px, borderline width — Change: `px-4 sm:px-6`; `flex-wrap`, `min-h-11`.
- `src/components/how-it-works/ForgettingCurve.tsx` — Issue: `min-w-[460px]` chart in a bare scroll box — Change: `scroll-slim -mx-5 px-5 sm:mx-0 sm:px-0 overflow-x-auto`.
- `src/components/how-it-works/RevisitSimulator.tsx` — Issue: `p-6` cards; "Start again" ~16px — Change: `p-5 sm:p-7`; `min-h-11 sm:min-h-0`.
- `src/components/auth/AuthForms.tsx` — Issue: segment buttons 40px; inputs lacked autocomplete/label association; text buttons ~16px — Change: `min-h-11 sm:min-h-0`; ids + `autoComplete` (name, email, current/new-password, invite `off`); `min-h-11`.
- `src/components/auth/AuthShell.tsx` — Issue: "Back to home" 36px — Change: `min-h-11 sm:min-h-0`.
- `src/components/RouteFallbacks.tsx` — Issue: `p-8` — Change: `p-5 sm:p-8`.

## Student: dashboard, planner, curriculum, videos

- `src/components/VideoPlayer.tsx` — Issue: inline scroll lock; 36px close; panel could exceed the viewport; fallback link 36px — Change: `useBodyScrollLock`; `size-11 sm:size-9`; `max-h-[calc(100dvh-2rem)] overflow-y-auto`; `min-h-11`.
- `src/components/weekly/WeeklyFocusCard.tsx` — Issue: `grid-cols-3` video tiles ~100px — Change: `grid-cols-2 sm:grid-cols-4`.
- `src/components/curriculum/CurriculumFilters.tsx` — Issue: subject chips 36px; "Add … to your plan" ~16px; tutor filter 40px — Change: `h-11 sm:h-9`; `min-h-11 sm:min-h-0`.
- `src/components/curriculum/CurriculumPage.tsx` — Issue: tutor filter `grid-cols-3`; `p-5`/`p-6` cards; long titles overflowed; back button ~20px — Change: `grid-cols-1 sm:grid-cols-3`; `p-4 sm:p-5/6`; `text-xl sm:text-2xl break-words`; `min-h-11`.
- `src/components/curriculum/SpecSearch.tsx` — Issue: Clear/Back buttons ~16px; `px-5`; `h4 font-semibold` — Change: `min-h-11 sm:min-h-0`; `px-4 sm:px-5`; `font-bold`.
- `src/components/curriculum/SpecPointDetail.tsx` — Issue: tutor actions 28px; MCQ row overflowed; delete icon 22px unnamed; Edit/Join/Open pills ~20px — Change: `min-h-11 sm:min-h-0`; `flex-wrap gap-2`; `tap-target` + `aria-label`; `tap-target`.
- `src/components/curriculum/TopicCard.tsx` — Issue: `px-5`/`p-5`; delete icon 24px; Add/Cancel 32–40px; `h4 font-semibold` — Change: `px-4 sm:px-5`; `tap-target`; `h-11 sm:h-10/8`; `font-bold`.
- `src/components/curriculum/TopicCreate.tsx` — Issue: Cancel/Create 32px — Change: `h-11 sm:h-8`.
- `src/components/planner/StudentPlanner.tsx` — Issue: section tab strip ~410px bled past the card; subject pills 32px; week arrows 28px/4px gap; `<summary>` rows 20px; exam-date input/Reorder/Catch-up 36px — Change: `overflow-x-auto scroll-none -mx-4 px-4`, tabs `h-11 sm:h-10`; `h-11 sm:h-8` + `gap-2`; `size-11 sm:size-7`; `py-3 -my-3 sm:py-0 sm:my-0`; `h-11 sm:h-9`.
- `src/components/planner/ThisWeekLanes.tsx` — Issue: "Next: …" link 36px, unbounded — Change: `max-w-full min-h-11 sm:min-h-0`.
- `src/components/planner/DoNowPanel.tsx` — Issue: 20px tick button — Change: `tap-target`.
- `src/components/planner/CatchUpPanel.tsx` — Issue: "Practise now" 32px — Change: `h-11 sm:h-8`.
- `src/components/planner/PlannerPointItem.tsx` — Issue: expandable row 36px — Change: `min-h-11 sm:min-h-0`.
- `src/components/planner/CoveredLedger.tsx` — Issue: pills/Retake 32px; `h3 font-semibold` — Change: `h-11 sm:h-8`, `flex-wrap gap-2`; `font-bold`.
- `src/components/planner/FullPlanTimeline.tsx` — Issue: month arrows 32px, select 40px, "This week" 36px; revision summary/"Show whole topic" 24px — Change: `p-3 sm:p-2`, `min-h-11 sm:min-h-0`, `gap-2`; `py-2.5 -my-2.5 sm:py-0 sm:my-0`.
- `src/components/planner/fullPlan/PlanAttention.tsx`, `PlanLine.tsx`, `PlanSummary.tsx`, `PlanWeekList.tsx` — Issue: 16–40px buttons — Change: `h-11 sm:h-8/9` / `min-h-11 sm:min-h-0`.
- `src/components/planner/MemoryPanel.tsx` — Issue: subject tabs ~24px — Change: `min-h-11 sm:min-h-0`, `flex-wrap gap-2`.
- `src/components/planner/ReturningTopicInfo.tsx` — Issue: (i) chip 28px; "View original week" 28px — Change: `tap-target`; `min-h-11 sm:min-h-0`.
- `src/components/planner/ScheduleComparison.tsx` — Issue: summary 20px; Preview/Apply 36px — Change: `py-3 -my-3`; `min-h-11 sm:min-h-0`.
- `src/components/planner/WeekBreakdown.tsx` — Issue: ~380px chip strip pushed the header past 343px — Change: `min-w-0 max-w-full overflow-x-auto scroll-none`.
- `src/components/planner/WeekPointRow.tsx`, `WorkChips.tsx` — Issue: Watch/Homework/Quiz/"Focus again" chips ~24px — Change: `tap-target` (visual unchanged; 44px hit area verified by hit-testing).
- `src/components/planner/WeekSwitcher.tsx`, `WeeklyPlanPanel.tsx` — Issue: arrows 32px, "Today" 20–24px, pills 32px — Change: `size-11 sm:size-8`, `tap-target`, `h-11 sm:h-8` + `gap-2`.
- `src/components/planner/WithheldPlanPoints.tsx` — Issue: summary 20px — Change: `py-3 -my-3 sm:py-0 sm:my-0`.
- `src/components/planner/TopicOrderEditor.tsx` — Issue: sticky Save bar under the home indicator; move/drag controls 28–32px; select/reset 36–40px — Change: `bottom-[calc(0.75rem+env(safe-area-inset-bottom))]`; `p-3.5 sm:p-2`, `tap-target`; `min-h-11 sm:min-h-0`.

## Student: homework, quizzes, live, messages, billing, account

- `src/routes/_authenticated/messages.tsx`, `src/routes/demo/student/messages.tsx` — Issue: list and thread rendered as two stacked 70vh panes on phones — Change: single-pane flow below `lg` (list hides once a thread is open, "← All conversations" back button); "Ask a question" `h-11 sm:h-10`.
- `src/components/chat/ThreadView.tsx` — Issue: header cluster overflowed; bin 36px; confirm/draft buttons 32–36px; composer placeholder-only — Change: `flex-wrap`; `size-11 sm:size-9`; `h-11 sm:h-9/8`; `aria-label`.
- `src/components/chat/ThreadList.tsx` — Issue: "Show older" 36px — Change: `min-h-11`.
- `src/components/chat/NewThreadDialog.tsx` — Issue: no scroll lock/Escape/backdrop close; `90vh`; 20px close; chips/buttons 36–40px; `p-6` — Change: `useBodyScrollLock`, Escape, backdrop closes only while the form is empty, `100dvh` bound, `tap-target`, `h-11 sm:h-9/10`, `p-4 sm:p-6`.
- `src/components/chat/ContextPicker.tsx` — Issue: tabs 32px; remove × 16px; rows ~40px; search placeholder-only — Change: `h-11 sm:h-8`; `tap-target`; `min-h-11`; `aria-label`.
- `src/components/homework/HomeworkSheetPage.tsx` — Issue: back link and Acknowledge under 44px — Change: `min-h-11 sm:min-h-0`; `h-11 sm:h-9`.
- `src/components/BuiltInHomework.tsx` — Issue: textareas placeholder-only; submit/confirm 40px; long prompts overflowed — Change: `aria-label`; `h-11 sm:h-10`; `min-w-0 break-words`.
- `src/components/mcq/McqsPage.tsx`, `TakeMcqPage.tsx` — Issue: `p-5/6`; answer options ~40px; back link small — Change: `p-4 sm:p-5/6`; `min-h-11 sm:min-h-0 break-words`; `min-h-11`.
- `src/components/live/HeaderLiveButton.tsx` — Issue: 36px Join/countdown — Change: `tap-target`.
- `src/components/live/LivePage.tsx`, `LiveSessionCards.tsx`, `NextSessionCountdown.tsx`, `SessionMeta.tsx` — Issue: `p-5/6`; tabs 32px; Remind/Join/Delete ~38px; bin 28px; non-wrapping rows; chip truncation without `min-w-0` — Change: `p-4 sm:p-5/6`; `min-h-11 sm:min-h-0`; `tap-target`; `flex-wrap`; `max-w-full`/`min-w-0`.
- `src/components/live/WhatsAppReminderModal.tsx` — Issue: no lock/Escape/backdrop/`role`; no max-height; 28px unnamed close; 40px controls; tel input unlabelled — Change: `useBodyScrollLock`, Escape + backdrop, `role="dialog"`, `100dvh` bound, `tap-target aria-label`, `h-11 sm:h-10`, `autoComplete="tel-national" aria-label`.
- `src/components/FilterBar.tsx` — Issue: filter pills ~30px; `p-5` — Change: `tap-target`; `p-4 sm:p-5`.
- `src/routes/_authenticated/billing.tsx` — Issue: `p-6` cards; small back link — Change: `p-4 sm:p-6`; `min-h-11`.
- `src/components/billing/InvoiceHistory.tsx` — Issue: 5-col table squeezed; View/PDF ~20px — Change: `scroll-slim -mx-4 px-4 overflow-x-auto` wrapper, `min-w-[34rem]`; `min-h-11`; `p-4 sm:p-6`.
- `src/components/billing/PaywallOverlay.tsx` — Issue: no scroll lock; `p-8`; ~16px text buttons — Change: `useBodyScrollLock`; `p-6 sm:p-8`; `min-h-11`.
- `src/components/billing/PaymentPending.tsx`, `CadenceSwitcher.tsx`, `SubscriptionPanel.tsx`, `PlanFacts.tsx`, `EnrolledSubjectsCard.tsx`, `ParentBillingSection.tsx`, `AddSubjectCard.tsx` — Issue: 16–36px buttons/segments; `p-6`; board select 32px unlabelled; checkbox rows 20px — Change: `h-11 sm:h-9`, `min-h-11 sm:min-h-0`, `tap-target`; `p-4 sm:p-6`; `h-11 sm:h-8 aria-label`; label rows `-my-3 min-h-11` (44px hit area inside the same 50px card).
- `src/components/billing/CadenceChangeDialog.tsx`, `CancelPlanDialog.tsx`, `PlanFeedbackDialog.tsx`, `RemoveSubjectDialog.tsx`, `SwitchBoardDialog.tsx` — Issue: no lock/Escape/backdrop close; `90vh`; 32px close; `p-6`; 40px buttons in non-wrapping rows; unbound labels — Change: `useBodyScrollLock`, Escape (not while pending), backdrop closes only while the form is empty, `100dvh` bound, `size-11 sm:size-8`, `p-4 sm:p-6`, `flex-wrap` + `h-11 sm:h-10`, `htmlFor`.
- `src/components/parent/ParentDashboardPage.tsx`, `EngagementStats.tsx`, `FeedbackList.tsx`, `GradePredictorCard.tsx`, `TrendsChart.tsx` — Issue: `p-6/8`; 3xl heading; 30px switcher chips; non-wrapping headers/legends — Change: `p-4/5 sm:p-6/8`; `text-2xl sm:text-3xl break-words`; `min-h-11`; `flex-wrap`, `min-w-0`.
- `src/routes/_authenticated/profile.tsx`, `parents.tsx`, `settings.tsx`, `notes.tsx`, `src/routes/demo/index.tsx` — Issue: `p-6/8`; 40px buttons and 16–32px text buttons; inputs lacked autocomplete; long email overflowed — Change: `p-4 sm:p-6/8`; `h-11 sm:h-10/8`, `min-h-11`; `autoComplete` name/tel/email, invite code `off`; `min-w-0 break-all`.
- `src/components/students/DeleteAccountSection.tsx` — Issue: dialog lacked scroll lock/backdrop close; `90vh`; 20px close; 36px buttons — Change: `useBodyScrollLock`; backdrop closes while the typed name is empty; `100dvh` bound; `tap-target`; `h-11 sm:h-9`.

## Tutor tools

- `src/routes/_authenticated/tutor.tsx` — Issue: `p-8`/`p-6`; tabs ~38px — Change: `p-5 sm:p-8`, `p-4 sm:p-6`, `min-h-11 sm:min-h-0`.
- `src/components/tutor/AnswerMarking.tsx`, `MarkingQueue.tsx`, `QuestionBuilder.tsx` — Issue: marks/score/count fields had no numeric keypad; 26–40px controls, 4px apart; placeholder-only textareas; `p-6`/`p-10` — Change: `inputMode="numeric"`; `h-11 sm:h-8/9/10`, `size-11 sm:size-auto`; `aria-label`; `p-4 sm:p-6`, `p-6 sm:p-10`; `flex-wrap`.
- `src/components/tutor/HomeworkForm.tsx`, `HomeworkLibrary.tsx`, `McqManager.tsx`, `WeeklyFocusManager.tsx`, `ThisWeekPanel.tsx`, `UseWeeklyFocusButton.tsx` — Issue: 18–40px buttons and chips; `p-5/6` — Change: `h-11 sm:h-7/10`, `min-h-11 sm:min-h-0`, `tap-target`, `size-11 sm:size-9`; `p-4 sm:p-5/6`; `flex-wrap`.
- `src/components/tutor/LiveForm.tsx`, `LiveFormParts.tsx`, `VideoForm.tsx` — Issue: "Auto Zoom" and "AI draft" floated inside their fields leaving ~120px to type; URL fields had no URL keyboard; 20–26px controls — Change: on phones the buttons sit below/above their fields at full height (absolute layout restored from `sm`); `inputMode="url"`; `min-h-11 sm:min-h-0`.
- `src/components/tutor/TaxonomyFields.tsx` — Issue: `grid-cols-2/3` crushed three selects — Change: `grid-cols-1 sm:grid-cols-2|3`.
- `src/components/tutor/SpecPointSelect.tsx` — Issue: search row 36px placeholder-only; Clear ~16px; topic/board headers 26–32px; checkbox rows 36px — Change: `min-h-11 sm:min-h-0`, `aria-label`, `tap-target`.
- `src/components/tutor/SpecPointVideoEditor.tsx` — Issue: modal had no scroll lock; unbounded panel `p-6 my-8`; 24px close; URL field no keyboard; ~30px buttons — Change: `useBodyScrollLock`; `max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6`; `tap-target`; `inputMode="url"`; `min-h-11 sm:min-h-0`.
- `src/components/CurriculumSyncPanel.tsx` — Issue: `p-6`; header didn't wrap; 36px buttons; textarea unlabelled — Change: `p-4 sm:p-6`; `flex-wrap`; `h-11 sm:h-9`; `aria-label`.
- `src/components/students/StudentsRoster.tsx`, `StudentHomework.tsx`, `StudentQuizzes.tsx` — Issue: tables had no scroll container; `px-5` cells; long emails widened columns — Change: `scroll-slim overflow-x-auto` wrapper; `px-4 sm:px-5`; `wrap-anywhere`.
- `src/components/students/StudentCourseEditor.tsx`, `StudentHeader.tsx`, `StudentMessages.tsx`, `StudentNotes.tsx`, `StudentOverview.tsx`, `StudentRecordPage.tsx` — Issue: 16–36px buttons; non-wrapping confirm rows; avatar `<img>` without intrinsic size; back link ~20px — Change: `h-11 sm:h-8/9`, `min-h-11 sm:min-h-0`; `flex-wrap`; `width={64} height={64}`.
- `src/components/planner/TutorPlannerPanel.tsx`, `TutorPlannerParts.tsx`, `TutorRoster.tsx`, `TutorRowMenu.tsx`, `TutorStudentPane.tsx`, `TutorTakeParts.tsx`, `TutorWeekTab.tsx`, `WeekReviewParts.tsx` — Issue: `p-10`; `min-w-[12rem]` rows on phones; 28–40px controls; `w-64` menu could leave the screen; placeholder-only textareas; non-wrapping headings — Change: `p-6 sm:p-10`; `min-w-0 sm:min-w-[12rem]`; `h-11 sm:h-7/8/9/10`, `size-11 sm:size-8`; `max-w-[calc(100vw-2rem)]`; `aria-label`; `flex-wrap`.
- `src/components/demo/DemoTour.tsx` — Issue: cards sat under the home indicator; ~38px buttons; 28px close — Change: safe-area bottom offset; `min-h-11 sm:min-h-0`; `tap-target`.
- `src/components/ui/chart.tsx` — Issue: no width guard; legend couldn't wrap — Change: `w-full min-w-0`; `flex-wrap`.

## Left alone (deliberately)

- Tailwind palette colours that predate this pass (`emerald-*`, `amber-*`, `rose-*`, `#2D8CFF`, `#25D366` …) in ~20 files. A design-system sweep, not a mobile defect; recolouring changes the product's look.
- Hand-rolled pills and micro-labels that predate this pass. Same reason.
- `TutorsSection` credentials bubble is hover-only; touch users see it nowhere. Showing it permanently doubles each card's height, so this is a design decision.
- `md:grid-cols-[100px,1fr]` in `TopicCard`/`TopicCreate` is invalid in Tailwind v4 (needs `[100px_1fr]`), so that desktop two-column form silently falls back to one column. Desktop-only; one-token fix if wanted.
- Tutor screens (`LiveForm`, `SpecPointSelect`, `MarkingQueue`, the roster tables) were not looked at in a browser: no tutor test account. `LiveForm` is the one with a visible phone-layout change worth a glance.
- iPad (768px+) keeps the hover rail: no hover there either, so labels only show as `title` tooltips on long-press. The drawer could be extended to `lg` if that matters.
