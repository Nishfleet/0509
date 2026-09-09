## What

net-positive-because: this PR is the smallest durable fix for issue #2050 — a regression gate that locks the BET 4 "no phantom changes" trust signal into the watchlist run-history surface. The capture-validity gate already suppresses phantom transitions (partial load, error page, anti-bot challenge, cookie/consent wall) and records them internally; the run-history renderer (`RecentChecksSection` → "What the latest check looked at") already lists those `capture_failed` attempts with their human reason and a timestamp. What was missing is the unit-level proof: no test asserted the renderer displays a `capture_failed` entry (with its reason) rather than omitting it. This PR adds `tests/capture-failed-visibility.test.ts`, the exact file the issue's verify/termination command names.

Scope is deliberately read-path only: no schema change, no migration, no D1 touch. It asserts the renderer surfaces the `capture_failed`/`skipped` state the gate already emits.

**What the test locks (issue #2050 acceptance):**
- A `capture_failed` row renders with its human reason label (e.g. "Page only partially loaded", "Page loaded as an error", "Anti-bot challenge wall", "Cookie consent wall") and the honest "No alert sent." line — never the raw `capture_failed`/`partial_load` token.
- The four suppression categories the issue names (partial load / error page / challenge / consent-wall phantom) each render.
- The attempt timestamp renders alongside the failed row (UTC-labeled datetime), so the run history proves when the refusal happened.
- A successful capture stays visually distinct from a refusal ("Captured" vs reason label + "No alert sent.").

**Regression gate (fleet-ops#366):** mutation-tested — when the renderer is changed to drop `capture_failed` entries, the suite fails, so a future regression that silently hides a suppression is caught rather than released. The suppression-category expected labels are hardcoded (not derived from the code under review) so the assertions are not tautological, and an unclassifiable `capture_failed` (null reason code) is asserted to surface rather than be dropped.

## Verification

Real runs, on this branch:

```
$ npx vitest run --configLoader runner --project node tests/capture-failed-visibility.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ NODE_OPTIONS="--max-old-space-size=8192" npx vitest run --configLoader runner --project node
 Test Files  629 passed (629)
      Tests  7483 passed (7483)
```

`run-proof:` the target suite `tests/capture-failed-visibility.test.ts` ran on this branch and went 6/6 green; the full node project (629 files, 7483 tests) re-ran green. Mutation check: with the renderer edited to drop `capture_failed`, the new suite fails — it is the `bin/prove-one-run-check` receipt run and a real `bin/fleet-exec-review-canary` gate.

`research:` the renderer already surfaces `capture_failed` (shipped by #1289 / #1476); this PR reuses that existing surface and adds the missing regression test rather than hand-building a new one (fleet-ops#517).

`help-first:` the new artifact is a vitest suite runnable via the repo's standard `npx vitest run` — no new `bin/` file, no `--help` surface to add.

## Reviewer round (product repo, one round — seat cursor/cursor-grok-4.6-high)

Ran via step 8 before arming (`bin/fleet-review-arm-check` exit 0 → senior seat usable). Reviewer ran `npx vitest run --configLoader runner --project node tests/capture-failed-visibility.test.ts` (green) and assessed the diff vs the issue acceptance.

Adjudicated against `~/.pi/agent/skills/review-adjudication/SKILL.md`:

- **Act on** (WARNING — tautological expected-label derivation in the "every reason category" test): FIXED. The suppression-category labels are now hardcoded in the fixture rather than derived from `formatCaptureAttemptReasonLabel`, so the assertion is independent of the code under review.
- **Act on** (CONSIDER — unclassified `reasonCode: null` path untested): FIXED. Added a test asserting an unclassifiable `capture_failed` surfaces with the honest generic line rather than being dropped.
- **Consider** (renderer-only coverage, no data-path): NOTED, recorded, not re-delegated. Acceptance bullet 3 targets the renderer; the data path that populates `latestRunCaptureAttempts` is already covered end-to-end by `tests/e2e/watchlist-run-history.spec.ts` (seeds a real `capture_failed` attempt via the J3 replay endpoint and asserts the human label renders).
- **Noted** (timestamp assertion not timezone-flaky; no-leak token checks weak but harmless): recorded.
- **Acceptance check** — all three bullets PASS.

## Acceptance

All issue bullets pass post-fix:
1. The watchlist run-history surface lists `capture_failed` entries with reason + timestamp — asserted for partial load, error page, anti-bot challenge, and consent-wall (suppressed-phantom) categories.
2. A suppression is inspectable, not silently dropped — the renderer shows the failed/suppressed run and why, in the honest "No alert sent." voice.
3. `tests/capture-failed-visibility.test.ts` asserts the run-history renderer displays a `capture_failed` entry (with its reason) rather than omitting it. No schema change — the test reads the existing `capture_failed`/`suppressed` state the gate emits.

`Closes #2050`