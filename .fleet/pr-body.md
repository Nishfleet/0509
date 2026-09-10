## DOMAIN IN, COMPETITORS WATCHED — collapse the funnel to one action

A logged-out visitor on `/search` can now select several suggested competitors and carry them through email-link signup into onboarding with zero re-entry, then confirm them in one click that creates the watchlists and starts the first proof capture immediately.

### What changed

1. **`/search` multi-select (issue #2113 extended).** The "who advertises against you" preview becomes selectable: each suggested competitor gets a checkbox (all checked by default). The CTA signs a short-lived handoff token carrying the searched domain + the picked candidates and links to signup.

2. **Signed handoff token (`app/lib/competitor-handoff.server.ts`).** A `base64url(payload).hex-signature` token keyed by `BETTER_AUTH_SECRET` (no new secret, no new env var), 30-minute TTL. It rides the existing `redirectTo` through the email-link round-trip, so the visitor's picks survive the gap with zero re-entry. A tampered or expired token fails verification with a named code and degrades to the plain `?website=` prefill path.

3. **Onboarding one-click confirm.** The setup checklist verifies the token, renders the confirmed candidates, and one click (`create-handoff-watchlists`) creates all watchlists within the plan cap and triggers the first proof capture for each — idempotent via the existing `createWatchlistWithinLimit` fingerprint dedupe + the existing queue primitives (one watchlist never gets two concurrent scans). It then routes to the same-session first brief so the first email fires as soon as the first capture completes.

### Honesty invariants preserved

- No plan-limit relaxations — every candidate is re-validated against the plan cap and the existing watchlist-dedupe before any write.
- No new queue systems — reuses `queueFirstWatchlistScan` / `queueFirstWatchlistScanForSignupFirstBrief`.
- No fake candidates — an empty discovery still renders nothing; a tampered/expired token degrades to the plain prefill path.
- No new dependencies.

### Verification

- `npm run typecheck` — clean (0 errors).
- `npm run test` (node project) — 650 files passed, 7737 tests passed; 1 pre-existing flaky timeout (`customer-readiness-candidate.test.ts`, a git-script test unrelated to this change, passes in isolation).
- `tests/competitor-handoff.test.ts` — 6 passed (round-trip, tamper, forged-signature, malformed, expiry, missing-secret).
- `tests/onboarding.route.test.ts` — 25 passed (incl. 3 new: creates N watchlists within cap, idempotent first capture, plan-cap rejection).
- `tests/search-competitor-preview.test.ts` — 10 passed (incl. new selectable-handoff render).
- `tests/integration/signup-first-brief.integration.test.ts` — 5 passed.
- `tests/integration/auto-competitor-seed.integration.test.ts` — 3 passed.

### run-proof

- `npm run typecheck` → exit 0
- `npx vitest run --project node tests/competitor-handoff.test.ts` → 6 passed
- `npx vitest run --project node tests/onboarding.route.test.ts` → 25 passed
- `npx vitest run --project node tests/search-competitor-preview.test.ts` → 10 passed
- `npx vitest run --project workers tests/integration/signup-first-brief.integration.test.ts` → 5 passed
- `npx vitest run --project workers tests/integration/auto-competitor-seed.integration.test.ts` → 3 passed

### Test plan

- Handoff token round-trip: sign → verify → exact payload.
- Tamper/forged-signature/expiry/missing-secret: each fails with a named code.
- Onboarding creates N watchlists within the plan cap and queues one first scan each.
- Idempotent first capture: an already-watched candidate is never double-created and never gets a second scan.
- Plan-cap rejection: over-cap candidates return `plan_limit_exceeded` with an upgrade path.

Closes #2174
