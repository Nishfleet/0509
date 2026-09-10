## reccos: Assert the e2e DB sentinel can never be enabled in production

Adds a launch-readiness/canary assertion that `SELECT enabled FROM e2e_test_mode WHERE id='local-authenticated'` is never 1 in production D1 (fits the existing canary pattern in `app/routes/api.launch-readiness.canary.ts`).

- The canary reads the sentinel row and, if `enabled` is `1`, fails closed with a red `503` and blocker `e2e_test_mode_enabled_in_production`, before creating any canary evidence. It also fails closed (blocker `e2e_test_mode_sentinel_unreadable`) if the sentinel query itself cannot be answered, so the assertion can never silently report green.
- The check is surfaced in every green canary payload as `e2eTestModeSentinel: { enabled: false }`, so the assertion is observable even when the sentinel is off.

Closes #2354

Verification:
- `npx vitest run --configLoader runner --project node tests/launch-readiness-canary.route.test.ts` → 34 passed (new sentinel-red + sentinel-unreadable tests)
- `npx vitest run --configLoader runner --project node tests/e2e-auth.server.test.ts tests/e2e-route-guards.test.ts tests/launch-readiness-canary-cycle.test.ts` → 42 passed
- `npx vitest run --configLoader runner --project node --changed origin/main` → 34 passed

run-proof: vitest run ok: 34 (canary route), 42 (related e2e/canary-cycle), 34 (affected-tests node)

net-positive-because: the added lines are the fail-closed sentinel guard, its read-error hardening, and their unit coverage (no churn).

Test plan:
- Flipping `e2e_test_mode.enabled` to `1` for `id='local-authenticated'` in a test environment turns the canary red (covered by the new unit test); the green path asserts the sentinel check is present; a thrown sentinel query also turns the canary red.

Review: reviewer seat opencode/nemotron-3-ultra-free
- Act on: fail-open on sentinel read error (Warning) — the helper now returns `readError` and the canary fails closed (503 `e2e_test_mode_sentinel_unreadable`) when the sentinel query cannot be answered, with a new unit test.
- Consider: same fail-open item resolved by the Act-on above.
- Noted: duplicate the sentinel id/truthiness instead of importing from `app/lib/e2e-auth.server.ts` — kept local for the smallest durable fix; the id is documented and mirrored.
- Noted: `if (!env.DB)` guard inside the helper is defensive (caller already returned `missing_db`) — kept for standalone safety.