# Landscape phone audit and fixes — 2026-10-03

An audit of the platform on a phone turned sideways, and the fixes for every
finding. The full report, with the measurements and drawings, is
https://claude.ai/artifact/Bf5sWu9VaVYa6NkZzdZnqC. Measured at 667×375 (iPhone
SE), 844×390 (iPhone 12–16), 932×430 (Pro Max) and 844×340 (Safari's bars
showing), with the notch simulated as 47px or 59px side margins, on the test
student `123@123.com` and its linked test parent.

## Why landscape broke

Turned sideways, a phone is 667–956px wide, past `sm` (640px) and usually past
`md` (768px). The width breakpoints handed it desktop layouts: the hover icon
rail, compact desktop buttons, a header with everything in it. But it is only
340–440px tall. The 26 September phone pass (`MOBILE_UX_AUDIT_2026-09-26.md`)
was tested upright only.

## The rules this adds

- **`short:`** in `styles.css`: `@media (height <= 31.25rem)`. Only a phone on
  its side is that short; no tablet or laptop is. Use it for anything pinned,
  sized to the screen, or meant to fit on one screen.
- **`rail:` / `drawer:`**: the sidebar is the hover rail only on a screen that
  is wide (`md`) and not short. Everything else gets the phone drawer.
- **`.thread-sideways`**: an open conversation's box on a short screen below
  `lg` takes the whole screen and drops its card. Unlayered, like the card
  rules it overrides. The page content isolates (`.page-aurora`), so no
  z-index lifts the thread over the pinned header: while it is open the header
  is `visibility: hidden` (`main:has(.thread-sideways) > header`).
- **Tap sizes**: write `min-h-11 sm:pointer-fine:min-h-0`, not `sm:min-h-0`.
  The phone size is undone only on a mouse-driven screen, so a phone either way
  up and a tablet keep 44px.

## Findings and fixes

| #   | Finding                                                                                                                              | Fix                                                                                                                                 | Files                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | Messages: the 70vh thread box left 34px for messages at 844×390                                                                      | Open on a short screen, the thread takes the whole screen; back button in its title row; one-line typing box                        | `styles.css`, `messages.tsx`, `ThreadView.tsx`                                 |
| 2   | Video: 16:9 at 768px wide is 431px tall in a 358px box; the bottom 74px (play bar, full screen) was cut off                          | Player width capped by the screen height: `max-w-[min(48rem,calc((100dvh-8rem)*16/9))]`                                             | `VideoPlayer.tsx`                                                              |
| 3   | Sidebar scrolled away with the page (all sizes); clipped on short pages, hiding Sign out; no menu button sideways; labels hover-only | Rail pinned (`sticky h-dvh`, own scroll, `z-50` on the sticky placeholder); short screens get the drawer, padded by the notch inset | `AppLayout.tsx`, `sidebarLabel.ts`, `SidebarSearchButton.tsx`                  |
| 4   | Pinned header wrapped to two rows, 117–127px                                                                                         | Short screens: one row, `py-2`; no Forward, no course chip, compass without words, short Live label                                 | `AppLayout.tsx`, `CourseBadge.tsx`, `StudentGuide.tsx`, `HeaderLiveButton.tsx` |
| 5   | Account menu ran off the screen, hiding Sign Out                                                                                     | `max-h-[calc(100dvh-4.5rem)]` and its own scroll                                                                                    | `UserMenu.tsx`                                                                 |
| 6   | Website top bar cut Sign up off from 768px to ~945px; hero CTA below the first screen                                                | Section links in the menu below `lg`; tighter hero on short screens                                                                 | `landing/Nav.tsx`, `landing/Hero.tsx`                                          |
| 7   | Tour card hid Next below its fold on 4 of 10 steps; covered 58% of its target                                                        | Buttons pinned under the scrolling text; on a short, wide screen the card keeps to the right edge; left clamped clear of the notch  | `StudentGuide.tsx`                                                             |
| 8   | ~250 phone tap sizes shrank back above 640px                                                                                         | `sm:` → `sm:pointer-fine:` on each undo token (mechanical, 93 files)                                                                | many                                                                           |
| 9   | "Ask a question": Send 286px below the fold                                                                                          | Title and button rows pinned, form scrolls between; picker list shorter on short screens                                            | `NewThreadDialog.tsx`, `ContextPicker.tsx`                                     |
| 10  | Parent's 448px thread box taller than the screen                                                                                     | Same as 1                                                                                                                           | `ParentMessages.tsx`                                                           |
| 11  | Paywall card (405px since "Message your tutor") couldn't scroll                                                                      | Overlay scrolls, card `m-auto`                                                                                                      | `PaywallOverlay.tsx`                                                           |
| 12  | Sign-in: Log in below the first screen                                                                                               | Less spacing on short screens                                                                                                       | `auth/AuthShell.tsx`                                                           |
| 13  | Note pictures taller than the space under a two-row header                                                                           | Fixed by 4                                                                                                                          | —                                                                              |
| 14  | Fixed layers ignored the notch                                                                                                       | Toast offset and WhatsApp button use the safe-area insets; the drawer and full-screen thread pad themselves                         | `__root.tsx`, `FloatingWhatsApp.tsx`                                           |
| 15  | WhatsApp button overlaps a pricing button at 390px                                                                                   | Left: a floating button covers whatever scrolls under it, and nothing is unreachable                                                | —                                                                              |

## Deliberately left

- The tutor live form's "Auto Zoom" button keeps `sm:min-h-0`: from 640px it
  sits inside its input, and at 44px it would overflow it.
- The `/demo` showcase is untouched (sales only).
- Tutor screens were not audited (agreed scope).

## How it was checked

On the test student and test parent at 844×390, 844×340 and 667×375 (touch),
plus 375×812, 768×1024 and 1280×800 for the sizes that must not change. The
full-screen thread was checked on a real conversation: with Ali's OK the test
student sent one message to his tutor account, and it was deleted straight
after (thread, message and notification all gone). That check found the header
drawing over the thread, fixed in the same PR.

Still copies of the markup, not live: quiz taking, writing homework answers and
the paywall. The test accounts have no quiz sets, no unsubmitted homework and
an active plan. The browser pane cannot copy touch above 768px wide, Safari's
bars or the keyboard.
