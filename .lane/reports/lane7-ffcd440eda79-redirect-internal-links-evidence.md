# Redirecting internal links on home — dogfood ffcd440eda79 (2026-08-21 lane 7) — already resolved on main by merged PR #570

**Status: already resolved; this lane records the evidence only. No product
code change warranted.**

Branch: `lane7/ffcd440eda79-redirect-internal-links-evidence`
Base: `origin/main` at `422fbd55` (#806)

## Item

- [ ] [dogfood ffcd440eda79] Redirecting internal links on home
  [dogfood 20260808T074205Z-msk2fl3n]

## Verdict

No code change was warranted. The item is already fixed, merged into
`origin/main`, and the fix remains intact on the current `main` tip:

- PR #570 — `a0f82a61` "fix(seo): point auth-gated public links straight at
  the login destination (dogfood ffcd440eda79)" — is MERGED into `origin/main`
  (`git merge-base --is-ancestor a0f82a61 origin/main` → true). The resolving
  commit is an ancestor of the current `main` HEAD (`422fbd55`).
- The shared helper `appLinkTarget` (`app/lib/app-link.ts`) rewires every
  anonymous-visible auth-gated link on the flagged public pages to the
  byte-identical final destination: anonymous visitors/crawlers get
  `/auth/login?redirectTo=<encoded path>` directly, signed-in visitors keep
  the direct app URL — no redirect hop.

## Evidence on current main (`422fbd55`, 2026-08-21)

- **Home (`app/routes/marketing.tsx`)**: the only direct `/app` link is
  "Manage packs" (`/app/billing?source=top-up#top-ups`), session-gated behind
  `rootData.session && hasBundlePrice(...)` — anonymous crawlers never see it.
  Every anonymous-visible auth-gated CTA goes through `planIntentPath`
  (signed-in → `/app/billing?plan=...`, anonymous →
  `/auth/signup?redirectTo=<encoded>`). The primary CTA is
  `/app` if session else `/auth/signup`.
- **`app/components/marketing-nav.tsx`** (the single header for home, both
  compare pages, and the legal/doc shell): "Open app" uses
  `appLinkTarget("/app", rootData?.session)`.
- **`app/routes/help.tsx`**: `/app/notifications`, `/app/support?category=delivery`,
  `/app/billing`, `/app/support?category=billing`, `/app/support?category=security`,
  `/app/support` — all via `appLinkTarget`.
- **`app/routes/docs.tsx` and `app/routes/api.docs.tsx`**: `/app/developer-access`
  via `appLinkTarget`.
- **`app/routes/status.tsx`, `compare.*`, `changelog`, `terms`, `privacy`,
  `trust`, `not-found`, `competitor-monitoring`**: zero direct `to="/app"`
  links on this tip.
- **Byte-identical guard**: `requireSession` (`app/lib/auth.server.ts:241`)
  redirects to `/auth/login?redirectTo=${encodeURIComponent(pathname+search)}`
  — exactly the output `appLinkTarget` produces, minus the hop.
- The remaining `/app` links in `app/components/*` (dashboard-shell,
  plan-limit-state, permission-state, etc.) are authenticated workspace
  components only; none render on anonymous public pages.

## Verification on this tip

- `tests/app-link.test.ts` + `tests/marketing-nav.test.ts`: 2 files, 6/6 pass.
- `tests/help-runtime-truth.test.ts`, `tests/public-doc-routes.test.ts`,
  `tests/status.route.test.ts`, `tests/marketing-proof-brief.test.tsx`,
  `tests/marketing-rebuild.test.ts`: 5 files, 42/42 pass.
- Grep sweep of every public route for `to="/app` confirms the only remaining
  direct app link on a public page is the session-gated "Manage packs".

## Acceptance note

Per the improvement-loop convention recorded by lanes 1, 9, and 16 for this
same item, no duplicate product PR is opened. The item's verify step (dogfood
rerun dropping the fingerprint) is satisfied by the merged fix; a future
dogfood rerun of the SEO Fix Kit engine against the live site confirms the
fingerprint is gone from active findings.

## Files

- `.lane/reports/lane7-ffcd440eda79-redirect-internal-links-evidence.md` —
  evidence record only; no product code touched.
