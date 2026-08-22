# Homepage top-nav signup CTA + magic-link next-step verification (no code change required)

**Status: already resolved by PR #554 (follow-up #558); this lane records the evidence only.**

Branch: `report/lane1-nav-signup-cta-already-resolved`
Base: `origin/main` at `0508dae0`

## Item

- [ ] Homepage top nav has no signup CTA; signup is below-fold or an extra hop
  via Sign in, and the magic-link step is [opaque/unclear] (lane 1 checklist
  item, packet text truncated after "the magic-link step is o…").

## Verdict

No code change was warranted. Both halves of the item — a top-nav signup CTA
that reaches `/auth/signup` directly, and plain-words next-step guidance for
the signup magic-link flow — were already implemented, merged to `main`, and
are live in production:

- **Top-nav signup CTA**: PR #554 / commit `49ed0e28`
  (`ux(nav): give anonymous visitors a Sign up CTA in the public header`),
  merged into `origin/main`, is an ancestor of the current `main` HEAD
  (`0508dae0`). `MarketingNav` (the one header shared by the homepage, `/ads/*`
  brand pages, compare pages, and the legal/doc shell) now renders a "Sign up"
  pill CTA → `/auth/signup` beside "Sign in" and "Open app" — above the fold on
  every public surface, no scrolling and no detour through Sign in.
- **Magic-link next-step guidance**: the same PR (#554) rewrote the
  signup-mode `AuthForm` copy: pre-submit it states the next step ("We'll send
  a setup link to that inbox — open it to verify, then add a competitor and
  start tracking"), and the post-send recovery state adds timing + spam/
  promotions guidance ("It usually arrives within a minute. If it's slow, check
  your spam and promotions folders before resending"). Login-mode copy is
  untouched (locked by tests).
- **Mobile follow-up**: PR #558 / commit `834da2df`
  (`fix(nav): stop Gate-B mobile fold fail from three-action header wrap`)
  is also in `main`, so the three-action header keeps ≥44px touch targets with
  no horizontal overflow at 320–1024px.

## Code evidence on this tip

- `app/components/marketing-nav.tsx` — "Sign up" pill (`ld-nav-pill`) →
  `/auth/signup` in `.ld-nav-actions`, with "Open app" demoted to the same
  text-link treatment as "Sign in".
- `app/components/auth-form.tsx` — signup-mode pre-submit next-step copy
  (lines 68–70) and post-send recovery guidance (lines 78–83); login copy
  unchanged.
- `app/app.css` — `.ld-nav-pill` styling for both `.f9-home` and
  `.f9-legal-page`; ≤860px nav grid treatment from #554/#558.
- Regression tests on `main`: `tests/marketing-nav.test.ts` and
  `tests/auth-form-signup-guidance.test.ts` (5 tests covering pre-submit
  next-step copy, post-send recovery copy, and login-mode isolation).

## Live verification (2026-08-09)

Loaded `https://0509.io/` in a real browser (Camoufox):

- Account navigation in the top header renders all three actions above the
  fold: `Sign in` → `/auth/login`, `Open app` → `/app`, and `Sign up` →
  `/auth/signup` (pill).
- Section CTAs also point straight at `/auth/signup` (no `Sign in` detour).
- Loaded `https://0509.io/auth/signup`: heading "Verify your work email to
  start.", pre-submit copy "Use a work email. We'll send a setup link to that
  inbox — open it to verify, then add a competitor and start tracking.", submit
  button "Send setup link" (live post-send state not exercised to avoid sending
  a real production magic-link email; it is locked by the passing regression
  tests above).

## Checks

- Focused regressions `npx vitest run tests/marketing-nav.test.ts
  tests/auth-form-signup-guidance.test.ts`: 2 files, 8/8 passed on this tip.
- `git diff --check`: clean (markdown-only change; no product code touched).

---
