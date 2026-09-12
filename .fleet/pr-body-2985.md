Closes #2985
Relates to #2964

## What

Public hot-path rate limiting moves off D1 onto the native Cloudflare Rate Limiting binding (`RATE_LIMITER`), and fails CLOSED with 429 + Retry-After:

- `/search`: per-IP backstop + per-anonymous-browser buckets counted at the edge (was: D1 `rate_limit_events` rows, fail-open whenever D1 was degraded — the #2964 live failure).
- `/api/demo-proof`: scope `public-proof-brief` through the worker's global edge gate (`enforceRequestRateLimit`), which runs before the loader, so an exhausted bucket never reaches the proof-brief cache read. The #2964 route-level D1 bucket (fail-open) is superseded.
- `/auth/*` and remaining public scopes (`/status`, `/api/*` reads, writes, webhooks, delivery-status): dispatched by `rateLimitPolicyFor` through the edge binding, fail closed.
- D1 atomicClaim stays ONLY for cost-bearing routes: authenticated search, search-selection, billing, share-pdf caps and share-pdf single-flight.

The Rate Limiting binding only supports 10s/60s periods, so legacy 10-minute budgets keep the same sustained rate per 60s (20/10min → 2/60s; 30/10min → 3/60s). Sustained throughput is unchanged; the burst shape changes. `/status` advertises no hard numbers, so no doc drift.

Degraded modes now return 429 + Retry-After (binding missing, edge limiter throwing, D1 cost-path error) instead of silently admitting unbounded traffic. The scope-named observability logging introduced by #3059 is preserved on the remaining D1 paths, now reporting fail-closed.

## Verification

- `npx vitest run --configLoader runner --project node --changed origin/main` → 356 test files, 4464 tests, 0 failures, exit 0. First run: 1 failure (the 21st-cold-query burst test, written against the old 20/10min D1 budget); fixed to the 2/60s edge budget, second run green.
- Burst proof, 429 + Retry-After:
  - "an exhausted burst returns a labeled 429 with Retry-After from the edge limiter" — tests/demo-proof.rate-limit.test.ts
  - "distinct cold queries from the same browser still 429 once the edge browser budget is spent" — tests/search.route.test.ts
- Zero D1 writes on the public path: "across a full burst, zero rows touch the D1 hot path (the #2964 fail-open write path is gone)" — tests/demo-proof.rate-limit.test.ts
- Fail-closed gates: `RATE_LIMITER` binding missing → 429 + `Retry-After: 60`; edge limiter throws → 429 (tests/rate-limit.server.test.ts, 42 tests across the two rate-limit suites, all passing).
- `npx wrangler types` → exit 0; `RATE_LIMITER: RateLimit` binding present in the generated `worker-configuration.d.ts`; `wrangler.e2e.jsonc` mirrors the production binding so e2e/preview runs the same wiring.
- `sgscan --base origin/main` → exit 0 (one INFO: unsafe-formatstring, pre-existing pattern).

run-proof: vitest --project node --changed origin/main exit 0, 4464/4464 passed; npx wrangler types exit 0 with RATE_LIMITER in worker-configuration.d.ts; sgscan --base origin/main exit 0

mechanical-fix: shipped as tests — fail-closed 429 gates (binding missing / limiter throws / burst→429 / zero-D1-writes) in tests/rate-limit.server.test.ts, tests/demo-proof.rate-limit.test.ts, tests/search.route.test.ts.

test-removal-justified: the removed assertions belonged to the D1 fail-open counting mechanism that #2985 deletes for public scopes; the replacement edge Rate Limiting implementation is gated by the new fail-closed burst/missing-binding/limiter-throw/zero-D1-writes tests.
net-positive-because: not needed — the diff is net-negative (642 additions, 735 deletions).

## Test plan

- CI: vitest node project, typecheck, deploy gates.
- First production deploy after merge: confirm the `RATE_LIMITER` binding materializes in the deployed worker (wrangler.jsonc `unsafe.bindings`, type `ratelimit`), then a manual burst against `/api/demo-proof` / `/search` returning 429 + Retry-After.

loose-ends: RATE_LIMITER binding must be confirmed present on the next deployed worker (config-only until then); the live-URL burst→429 proof needs that deploy, which is CI-gated and not done locally.
