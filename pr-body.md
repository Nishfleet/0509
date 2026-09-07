## What

Raise the proof-capture screenshot success rate toward the ≥90% target by closing the R2-upload bail-out gap in the capture pipeline.

The screenshot is the primary evidence artifact, but `persistBrowserArtifacts` did the R2 `put` once with no retry — a transient R2 failure silently dropped the screenshot and produced a `succeeded` capture with no `screenshot_artifact_key` (the R2-upload bail-out reason behind the 19% rate). This adds a bounded one-retry guard (`putArtifactWithRetry`) for both the screenshot and HTML puts, mirroring the existing screenshot-capture retry budget (`SCREENSHOT_CAPTURE_ATTEMPTS`).

## Bail-out analysis (acceptance 1)

Top 3 bail-out reasons that prevent screenshot persistence, and their status:

1. **R2 upload failure** (`screenshot_persistence_failed`) — **FIXED here.** The R2 `put` had no retry; a transient failure lost the screenshot. Now retried once before the capture is marked `succeeded` without an artifact.
2. **Browser timeout** — already mitigated. The rendered chain (Browser Run → Browserless) retries transient provider failures (`MAX_BROWSERLESS_PROOF_RETRIES`), and `requireScreenshot: true` on the proof-capture path means a capture that cannot produce a screenshot is `capture_failed`, never `succeeded` without one.
3. **Screenshot capture failure** — already mitigated. The viewport screenshot is retried (`SCREENSHOT_CAPTURE_ATTEMPTS = 2`), and the `proof_capture_succeeded_without_screenshot` guard in `createProofCapture` refuses a `succeeded` row with no screenshot key.

Budget skip produces `skipped_due_to_budget` (not `succeeded`), so it does not affect the succeeded-without-screenshot metric.

## Runtime guard (acceptance 2)

`putArtifactWithRetry` retries the R2 persistence once on transient failure before the capture is marked `succeeded` without an artifact. With `requireScreenshot: true`, a capture that cannot persist the screenshot is still not marked `succeeded` without one.

## Test (acceptance 3)

The issue's referenced path `tests/proof-capture-screenshot-rate.test.ts` does not exist; the #1747 regression test is `tests/integration/screenshot-rate-target.integration.test.ts`, which runs against a real D1 binding in the `workers` vitest project. It passes (3 tests).

## Verification

```
npx vitest run --configLoader runner --project node tests/browser-run.server.test.ts
  Test Files  1 passed (1)
  Tests       7 passed (7)

npx vitest run --configLoader runner --project workers tests/integration/screenshot-rate-target.integration.test.ts
  Test Files  1 passed (1)
  Tests       3 passed (3)

npx vitest run --configLoader runner --project node
  Test Files  592 passed (592)
  Tests       7031 passed (7031)

npx vitest run --configLoader runner --project workers
  Test Files  28 passed (28)
  Tests       147 passed (147)

npm run typecheck  -> exit 0
```

run-proof: node suite 7031/7031 green; workers integration 147/147 green; typecheck exit 0

## Scope

No D1 schema change. No workflow edits. No gate-owned path edits. No new systemd unit/timer/workflow.

Closes #1856
