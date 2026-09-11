# Lane evidence — claim/issue-2724

Issue: Nishfleet/0509#2724 — deploy red at `launch:readiness:predeploy`,
strictIssues=[browser_run_failed, coverage_unexpected_entry] while suites green.

## Diagnosis (verified against source and run logs)

Two independent causes:

1. `coverage_unexpected_entry`: `RELEASE_COVERAGE_MATRIX` in
   `scripts/playwright-release-manifest-reporter.mjs` pinned journey-3
   `finalUrl` on `/app/digests` and journey-6 on `/app/support`. Route diet
   phase 1 (#2213) folds both onto `/app/briefs` and `/app/help`, so the real
   proof entries matched no expectation and the strict `onEnd` returned
   `{status:"failed"}`, which `run-local-release-proof.mjs` reports as
   `browser_run_failed` even with all tests passing (run 34535279802, sha
   5138ba81 — pre-nonce-CSP).

2. `browser_run_failed` (real): nonce-based `script-src` shipped in e4273252
   (issue #2348) between the two failing runs. `ServerRouter` emits
   `StreamTransfer` inline chunks
   (`window.__reactRouterContext.streamController.enqueue/close`,
   react-router/dist/development/lib/dom/ssr/single-fetch.js) that take their
   nonce from the `ServerRouter` `nonce` prop — not from `<Scripts nonce>` in
   root.tsx. Without it the browser blocks both chunks under
   `script-src 'nonce-…'`, loader data never reaches the client router, and
   pages render but never hydrate. Run 34537446489 (sha a58f5abd, first run
   carrying e4273252) shows exactly that signature: status announcements keep
   their server-rendered text but never gain the client-appended suffix
   ("Search checks have recovered."), then `run:failed`, `artifact_missing`,
   `annotation:finalUrl`.

## Fix

- `app/entry.server.tsx`: `getOptionalCloudflareContext(loadContext)?.cspNonce`
  → `<ServerRouter nonce={cspNonce}>`. Chain verified:
  workers/app.ts sets `cloudflareRuntimeContext` with `cspNonce` on the
  `RouterContextProvider` passed to `requestHandler`.
- `scripts/playwright-release-manifest-reporter.mjs`: journey-3 finalUrl →
  `/app/briefs?firstrun=1`, journey-6 → `/app/help` (searchKeys `case`).
- `tests/app-redirects.test.ts`: fold-contract guard keeps release-coverage
  expectations off every `SHIPPED_FOLDS` oldPath.
- `tests/entry-server-csp-nonce.test.ts` (new): pins the context nonce reaching
  `ServerRouter`, and that a missing context nonce stays absent (never `nonce=""`).

## Verification

- `npx vitest run --configLoader runner --project node tests/entry-server-csp-nonce.test.ts tests/app-redirects.test.ts` → 19 passed.
- `npx vitest run --configLoader runner --project node --changed origin/main` → 6 files, 113 passed.
- No gate weakened: no assertions removed, no skip, no threshold change — the
  matrix now expects what the folded routes actually produce.
- Rebased onto origin/main e3c6f2d (was authored on 64-commit-old base by a
  prior claim that died to the seat fault before pushing).
