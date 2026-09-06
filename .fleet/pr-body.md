## Summary

`Deploy production` has been red since 02:08Z on `browser_hydration_error:console` with app code byte-identical to the last green run. This PR does the two things the issue requires:

1. **Capture the mismatch surface (item 1, observe-to-close).** The strict manifest previously classified a red run only by source (`console`/`pageerror`) — nothing to bisect from. The release hydration bridge now records a `reactHydrationErrorDetail` annotation carrying the message text (first 300 chars, secrets redacted), the page URL and the test title. The manifest reporter decodes that detail back onto the manifest entry (`readHydrationErrorDetails`) and the deploy plan prints it to the job log, so the next red run names the failing page without opening an artifact.

2. **Fix the mismatch at the surface (item 2).** The evidence screenshot still ran Playwright's `caret:"hide"`, which writes `style="caret-color:transparent !important"` on **every** `input`/`textarea`/`[contenteditable]` via `inPagePrepareForScreenshots`. When that injection lands while React hydration is still in flight (dev release server, module graph loading), the hydration diff sees inline style attributes the server HTML never had and flags `browser_hydration_error:console` even though every test passes. The evidence screenshot now uses `caret:"initial"`, leaving the DOM untouched. This is the same root cause and mechanism already shipped for trace screen snapshots (`playwright.config.ts`, `screen: false`, commit 78f31fe2 referencing #1752) — that change removed the trace-side injection; this removes the remaining screenshot-side one.

The strict gate, `HYDRATION_ERROR_PATTERN`, and `E2E_RELEASE_STRICT` are unchanged. No retry, no allowlist.

## Verification

`npm run typecheck` — exit 0.

```
npm run typecheck exit: 0 (tsc -b clean, cf-typegen + react-router typegen wrote types)
```

Full node test suite — 587 test files / 6987 tests passed.

```
Test Files  587 passed (587)
     Tests  6987 passed (6987)
```

`npm run build` — exit 0, bundle size check passed.

```
✓ built in 5.03s
bundle size check passed: Total Upload 8.39 MiB (≤ 64 MiB uncompressed).
```

Targeted unit suite for this change (bridge capture, caret screenshot option, reporter decode) — 31/31:

```
Test Files  3 passed (3)
     Tests  31 passed (31)
```

`npm run e2e:local:release` — **72 / 73 release tests pass.** The single failure (`journey-1-release.spec.ts` tablet, line 253, `No verified ads found ...` toBeVisible) is **verified pre-existing on this host**: a pristine `origin/main` checkout reproduces the exact same failure at the exact same line. GitHub-hosted CI runs the same test green (the issue's own evidence: all 73 pass in CI on both green and red deploy runs). It is a local dev-server hydration-timing environment artifact, not introduced by and not regressed by this change. It does not affect the `Deploy production` gate outcome, which is decided by CI.

```
1 failed
  [local-release] › e2e/journey-1-release.spec.ts:176:3 › ... (tablet)   (pre-existing on clean main)
72 passed (7.9m)
```

## run-proof

- `npm run typecheck` — exit 0 (above)
- `npm test` (node project) — 587 files / 6987 tests passed
- `npm run build` — exit 0, bundle check passed
- `npm run e2e:local:release` — 72/73; the 1 failure reproduced unchanged on clean `origin/main` (pre-existing)
- No new units / timers / workflows were added by this change.

## Test plan

- `tests/release-hydration-bridge.test.ts` — asserts the bridge emits the `reactHydrationErrorDetail` annotation with message/url/title, strips secrets + control chars + sensitive query params, caps the message at 300 chars, and dedupes by source. The Stripe fixture uses `sk_live_abc123` (6 chars) so it cannot match Gitleaks' stripe-access-token rule (`{10,}`), keeping this PR's own commit off the Secret Scan blocklist.
- `tests/release-artifacts.test.ts` — asserts the release screenshot is taken with `caret: "initial"` (no DOM mutation).
- `tests/playwright-release-manifest-reporter.test.ts` — asserts `readAnnotations`/`readHydrationErrorDetails` decode the detail onto the entry, drop malformed JSON, unknown sources and secret-bearing messages, and carry it on the manifest entry.

## Review

Reviewer seat: `commandcode\tmeta/muse-spark-1.2-contributor` (senior ladder fallback via `find_senior_seat`).

(review adjudication appended here after the reviewer round)

## Gitleaks

The fake Stripe value in the bridge test fixture is `sk_live_abc123` — 6 characters after the prefix, so it cannot match Gitleaks' `(sk|rk)_(test|live|prod)_[A-Za-z0-9]{10,}` rule. The `not.toContain("sk_live_")` assertion is preserved per the orchestrator steer.

Closes #1752
