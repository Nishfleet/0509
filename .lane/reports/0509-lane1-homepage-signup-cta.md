# Homepage top-nav signup CTA — already resolved by PRs #554 + #558

**Status: already resolved; this lane records the evidence only.**

Branch: `0509-lane1-homepage-signup-cta`
Base: `origin/main` at `f5cd7b5a` (#726)

## Item

- [ ] Homepage top nav has no signup CTA; signup is below-fold or an extra
  hop via Sign in, and the magic-link step is unclear (scout 2026-08-05).

## Verdict

No code change was warranted. The item is already landed on `origin/main`:

- **PR #554** — `49ed0e28` "ux(nav): give anonymous visitors a Sign up CTA
  in the public header", merged 2026-08-09. The public header now offers
  "Sign up" as the pill (single primary action) linking straight to
  `/auth/signup`, with "Sign in" and "Open app" as secondary arrow links —
  so an anonymous visitor no longer has to scroll below the fold or detour
  through Sign in. The same commit also added the signup-form magic-link
  step copy ("We'll send a setup link to that inbox…") and the post-send
  state with timing plus spam/promotions guidance, which is the rest of
  this item's scope.
- **PR #558** — `834da2df` "fix(nav): stop Gate-B mobile fold fail from
  three-action header wrap", merged 2026-08-09. Keeps "Sign in + Sign up"
  on one ≥44px touch-target row at ≤860px by hiding "Open app" (CSS, with
  a specificity fix), so the homepage live-search stays above the fold on
  phones. This is the direct follow-up to the CTA work; both commits are
  ancestors of the current `main` HEAD `f5cd7b5a` (#726), verified with
  `git merge-base --is-ancestor` in this worktree.

## Evidence on current main

- **Single public header**: `app/components/marketing-nav.tsx` is THE header
  for the landing page (`app/routes/marketing.tsx`), both compare pages, and
  the legal/doc shell (`PublicDocHeader`), per its own doc comment. It
  renders `Sign in` (`/auth/login`), `Open app` (`/app`), and the
  `ld-nav-pill` **Sign up** CTA (`/auth/signup`) in the
  `.ld-nav-actions` row — the pill is the single primary action for
  anonymous visitors, directly reachable from the homepage top nav with no
  scrolling and no hop through Sign in.
- **Direct signup route exists and defaults safely**: `app/routes/auth.signup.tsx`
  already linked nothing to it before; it now defaults a fresh visitor to
  `/app#setup-checklist` via `safeRedirectPath` and keeps the honest
  pre-send message, "Check your email. The setup link will verify you and
  create the account."
- **Magic-link step copy is complete** (PR #554's auth-form half):
  `app/components/auth-form.tsx` pre-send says "Use a work email. We'll
  send a setup link to that inbox — open it to verify, then add a
  competitor and start tracking.", the button is "Send setup link", the
  post-send state says "We sent a setup link. Open it to verify and create
  the account.", and the sent note gives timing plus spam/promotions
  guidance ("It usually arrives within a minute. If it's slow, check your
  spam and promotions folders…").
- **Mobile fold is protected**: `app/app.css` hides
  `.ld-nav-open-app` at ≤860px (both `.f9-home` and `.f9-legal-page`
  scopes) so Sign in + Sign up stay on one no-wrap row above the fold.
- **Regression pins**: `tests/marketing-nav.test.ts` asserts the full
  shared link set including `{ href: "/auth/signup", label: "Sign up" }`,
  the pill class, and the CSS hide rules; `tests/auth-form-signup-guidance.test.ts`
  pins the pre-send/post-send magic-link copy.

## Verification run (this lane)

Run on current main in this worktree (no product changes; report branch only):

```
$ npx vitest run tests/marketing-nav.test.ts tests/auth-form-signup-guidance.test.ts tests/auth-signup-structured-data.test.ts
 Test Files  3 passed (3)
      Tests  11 passed (11)
```

## Files

- `.lane/reports/0509-lane1-homepage-signup-cta.md` — this evidence record
  (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
