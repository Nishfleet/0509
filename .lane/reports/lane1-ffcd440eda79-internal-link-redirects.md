# Redirecting internal links on home — dogfood ffcd440eda79 (2026-08-15 lane 1) — fix implemented and verified in flight on PR #570

**Status: fix fully implemented, CI-clean, and mergeable on PR #570
(`fix/lane1-home-internal-link-redirects`, base `main`); not yet merged into
`origin/main`. This lane records fresh evidence and opens no duplicate product
PR, per the in-flight-fix convention lanes 9 and 16 already recorded for this
same item.**

Branch: `lane1/ffcd440eda79-internal-link-redirects`
Base: `origin/main` at `b21cc135` (#643)

## Item

- [ ] [dogfood ffcd440eda79] Redirecting internal links on home
  [dogfood 20260808T074205Z-msk2fl3n]

## Verdict

The item's root cause is still live on `origin/main`, and the fix that
resolves it is already fully implemented and verified on **PR #570**
(`fix/lane1-home-internal-link-redirects`, commit `08f05eac`). That PR is
`MERGEABLE`, 0 commits behind `origin/main` (head `a38f48af`), and has been
kept fresh by repeated main merges through 2026-08-14 — it has simply not been
merged yet. Per the improvement-loop convention for items with an in-flight
fix PR (recorded by lanes 9 and 16 for this exact item), this lane does not
open a duplicate product PR. It records fresh evidence instead.

The finding's verify step ("rerun the dogfood batch and confirm the
fingerprint drops out of active findings") can only tick after PR #570 merges
and deploys: the SEO Fix Kit engine audits the live https://0509.io site,
which still serves the 302-bouncing links. The last dogfood run
(`runs/20260808T074205Z-msk2fl3n.json`) still lists the four
`ffcd440eda79` findings (issue-3 home, issue-9 /help, issue-11 /docs,
issue-13 /status).

## The fix on PR #570 (verified on this tip)

`app/lib/app-link.ts` adds a single shared helper:

```ts
export function appLinkTarget(appPath, session) {
  if (session) return appPath;
  return `/auth/login?redirectTo=${encodeURIComponent(appPath)}`;
}
```

Anonymous visitors and crawlers therefore get the **byte-identical final URL**
the app-route guard (`requireSession` in `app/lib/auth.server.ts`) would
302-redirect to — minus the redirect hop — while signed-in visitors keep the
direct app URL. The helper is applied to every anonymous-visible auth-gated
link on the four flagged pages:

- `app/components/marketing-nav.tsx` — "Open app" → `/app`
- `app/routes/help.tsx` — `/app/notifications`,
  `/app/support?category=delivery`, `/app/billing`,
  `/app/support?category=billing`, `/app/support?category=security`,
  `/app/support`
- `app/routes/docs.tsx` and `app/routes/api.docs.tsx` —
  `/app/developer-access`

Home's only remaining direct app link (`/app/billing?source=top-up#top-ups`,
"Manage packs" in `app/routes/marketing.tsx`) is session-gated
(`rootData.session && hasBundlePrice(...)`), so anonymous crawlers never see
it — no redirect, nothing to change. That matches the audit on this tip.

## Verification on this tip (2026-08-15, origin/main `b21cc135`)

- Every anonymous-visible `to="/app...` link on the four pages is exactly the
  set PR #570 rewires via `appLinkTarget` (grep of `marketing-nav.tsx`,
  `help.tsx`, `docs.tsx`, `api.docs.tsx`; "Manage packs" is session-gated).
- `appLinkTarget` output is byte-identical to the `requireSession` guard's
  redirect target (lanes 9/16 verified this; the helper's format matches
  `auth.server.ts`).
- PR #570: `state=OPEN`, `mergeable=MERGEABLE`, `reviewDecision=` (no
  blocking reviews), head `a38f48af`, 0 commits behind `origin/main`
  `b21cc135`, required checks queued on the latest head as of 2026-08-14.
  On 2026-08-15 the PR is `mergeable=MERGEABLE` with
  `mergeStateStatus=BLOCKED` solely because the required checks
  (codex-node-checks, required-verifier-integrity, Gitleaks) are queued on
  the latest main-merge head — no conflicts, no blocking review. It becomes
  mergeable the moment those checks finish green.
- The product diff on PR #570 is 14 files / +134 −19 and touches no
  migration, billing, or auth surface.

## Acceptance note

The item closes when PR #570 merges, the deploy reaches production, and a
dogfood rerun of the SEO Fix Kit engine drops fingerprint(s) of patternKey
`ffcd440eda79` (fingerprints `56abe6e719ebe6ab17ee` home, `380692462848ca190c17`
/help, `f31d6b8348e4939e997b` /docs, `ab84b616b9e583005e9c` /status in the
20260808 run) from active findings. This lane's report records evidence only;
no product code touched.
