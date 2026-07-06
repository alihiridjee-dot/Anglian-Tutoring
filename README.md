# Anglian Tutoring

A production tutoring platform for GCSE and KS3 science (Biology, Chemistry, Physics) across Edexcel, AQA, and OCR. Built with React, TanStack Start, Tailwind v4, and Lovable Cloud (Supabase).

## Theme tokens

Light mode only. All colors are defined as CSS custom properties in `src/styles.css`. Reference the exact RGB values below when producing marketing assets, exports, or documents.

### Brand — Primary Blue

| Token            | Hex       | RGB             | Usage                              |
| ---------------- | --------- | --------------- | ---------------------------------- |
| `--primary`      | `#1D4ED8` | `29, 78, 216`   | Buttons, links, active nav         |
| `--primary-soft` | `#DBEAFE` | `219, 234, 254` | Chips, badge fills, hover surfaces |
| `--primary-deep` | `#1E3A8A` | `30, 58, 138`   | Emphasis, headings on hero         |

### Brand — Secondary Green

| Token           | Hex       | RGB             | Usage                         |
| --------------- | --------- | --------------- | ----------------------------- |
| `--accent`      | `#059669` | `5, 150, 105`   | Success, secondary CTAs       |
| `--accent-soft` | `#D1FAE5` | `209, 250, 229` | Success chips, positive fills |

### Neutrals

| Token                | Hex       | RGB             |
| -------------------- | --------- | --------------- |
| `--background`       | `#FFFFFF` | `255, 255, 255` |
| `--muted`            | `#F8FAFC` | `248, 250, 252` |
| `--secondary`        | `#F1F5F9` | `241, 245, 249` |
| `--border`           | `#E2E8F0` | `226, 232, 240` |
| `--muted-foreground` | `#64748B` | `100, 116, 139` |
| `--foreground`       | `#0F172A` | `15, 23, 42`    |

### Status

| Token           | Hex       | RGB            |
| --------------- | --------- | -------------- |
| `--destructive` | `#DC2626` | `220, 38, 38`  |
| `--warning`     | `#F59E0B` | `245, 158, 11` |

## Fonts

- Display: **Space Grotesk** (500/600/700) — headings, product wordmark
- Body: **Inter** (400/500/600)

Loaded via Google Fonts in `src/routes/__root.tsx`.

## Tech

- React 19, TanStack Start v1, Tailwind CSS v4, TypeScript strict
- Lovable Cloud (Supabase) — Auth, Postgres with RLS, Storage
- Lovable AI Gateway (`google/gemini-2.5-flash`) — MCQ generation
- Stripe (built-in Lovable Payments) — monthly subscriptions
- Microsoft Teams (via Lovable connector) — live session scheduling
