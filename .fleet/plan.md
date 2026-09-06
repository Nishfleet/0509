# Plan — Nishfleet/0509#1446 (manager: pi-issue-0509-1446)

## Situation (verified live + at branch level, 2026-09-06)

Issue #1446: `/ads/:domain` alias brand pages (ridge.com / oura.com) are not
redirected/canonicalized to their populated product pages (ridgewallet.com /
ouraring.com), splitting a brand's verified ads and link equity across two
competing indexable URLs.

The implementation already exists in this worktree (`claim/issue-1446`) as two
commits:

- `c2bf5cf1` — canonical alias resolver, route-level 301, sitemap exclusion,
  and the route-level test `tests/ads-alias-canonical-redirect.test.ts`.
- `c9ae1487` — restricts alias-landing attribution to the brand's own Meta
  page id. This is the REQUIRED fix for the real `codex-node-checks` FAIL that
  closed PR #1714: `tests/integration/brand-attribution.integration.test.ts`
  line 188 (`expected 2 to be 1`). Verified passing locally with this commit.

PR #1714 (which did NOT include `c9ae1487`) was closed without merge; nothing
was ever pushed to `origin/claim/issue-1446` (still at `f7e19ebb`, pre-work).
Manager job: verify green, review the diff, push the branch, open a fresh PR,
arm auto-merge.

## Phases

- [x] phase 1: confirm the canonical-alias implementation + attribution fix
      are committed and resolve the real CI FAIL
- [x] phase 2: green verification — route-level test, integration test,
      full node suite, workers suite, typecheck
- [x] phase 3: repo checks (sgscan, no agent attribution, exec-review canary)
- [x] phase 4: push `claim/issue-1446` to origin
- [x] phase 5: open PR with Verification/run-proof/research/help-first +
      Closes #1446, reviewer round (product repo: 0509), arm auto-merge
