Closes #2985
Relates to #2964

## What

Public hot-path rate limiting moves off D1 onto the native Cloudflare Rate Limiting bindings (`RL_*`), and fails CLOSED with 429 + Retry-After:

- `/search`: per-IP backstop + per-anonymous-browser buckets counted at the edge (was: D1 `rate_limit_events` rows, fail-open whenever D1 was degraded — the #2964 live failure).
- `/api/demo-proof`: scope `public-proof-brief` through the worker's global edge gate (`enforceRequestRateLimit`), which runs before the loader, so an exhausted bucket never reaches the proof-brief cache read. The #2964 route-level D1 bucket (fail-open) is superseded.
- `/auth/*` and remaining public scopes (`/status`, `/api/*` reads, writes, webhooks, delivery-status): dispatched by `rateLimitPolicyFor` through their edge binding, fail closed.
- D1 atomicClaim stays ONLY for cost-bearing routes: authenticated search, search-selection, billing, share-pdf caps and share-pdf single-flight.

**Platform contract (verified against the generated runtime types, the wrangler 4.123 config validator, and the local miniflare shim — all three agree):** the Rate Limiting binding carries its capacity in config (`simple: { limit, period }` — only 10s/60s periods) and the runtime call is `limit({ key })` with no per-call rate override. So each scope gets its own binding (`RL_AUTH` 2/60s, `RL_SEARCH_ANON_BROWSER` 2/60s, `RL_PROOF_BRIEF` 3/60s, `RL_SEARCH_SELECTION` 3/60s, `RL_SEARCH_IP` 10/60s, `RL_BRAND_PAGE` 12/60s, `RL_WRITE` 60/60s, `RL_STATUS` 120/60s, `RL_DELIVERY_WEBHOOK` 180/60s, `RL_API_READ` 240/60s, `RL_WEBHOOK` 300/60s), declared in `wrangler.jsonc` and mirrored in `wrangler.e2e.jsonc` + the integration `wrangler.test.jsonc`. Legacy 10-minute budgets keep the same sustained rate per 60s (20/10min → 2/60s; 30/10min → 3/60s; 120/10min → 12/60s); burst granularity changes, sustained throughput does not. `/status` advertises no hard numbers, so no doc drift.

Degraded modes now return 429 + Retry-After (binding missing, edge limiter throwing, D1 cost-path error) instead of silently admitting unbounded traffic. The scope-named observability logging introduced by #3059 is preserved on the remaining D1 paths, now reporting fail-closed. `keyByIpOnly` is honored on the D1 atomic-claim path too (share-pdf keeps its IP-only budget: UA rotation must not mint fresh buckets on a cost-bearing route).

## Verification

- `npx vitest run --configLoader runner --project node --changed origin/main` → 358 test files, 4470 tests, 0 failures, exit 0.
- Full `--project workers` suite (real workerd + real local D1 + REAL local edge limiters): 67 test files, 331 tests, 0 failures — including the six suites that CI showed red on the first push (ads/brand/timeline + verified-bot), now exercising the actual binding wiring.
- Burst proof, 429 + Retry-After:
  - "an exhausted burst returns a labeled 429 with Retry-After from the edge limiter" — tests/demo-proof.rate-limit.test.ts
  - "distinct cold queries from the same browser still 429 once the edge browser budget is spent" — tests/search.route.test.ts
  - integration: verified-bot sweep leaves the anonymous brand-page budget full — first 12 pass, 429 + Retry-After inside the bounded overshoot loop (tests/integration/rate-limit-verified-bot.integration.test.ts, real local edge limiter)
- Zero D1 writes on the public path: "across a full burst, zero rows touch the D1 hot path (the #2964 fail-open write path is gone)" — tests/demo-proof.rate-limit.test.ts
- Fail-closed gates: binding missing → 429 + `Retry-After: 60`; edge limiter throws → 429 (tests/rate-limit.server.test.ts).
- `npx wrangler types` → exit 0; the 11 `RL_*: RateLimit` bindings present in the generated `worker-configuration.d.ts`, and `RateLimitOptions` confirms the `limit({ key })` contract the code now uses.
- `sgscan --base origin/main` → exit 0 (one INFO: unsafe-formatstring, pre-existing pattern).

run-proof: vitest --project node --changed origin/main exit 0, 4470/4470 passed; full vitest --project workers exit 0, 331/331 passed with the real local RL_* edge limiters; npx wrangler types exit 0 with the 11 RL_* bindings in worker-configuration.d.ts; sgscan --base origin/main exit 0

mechanical-fix: shipped as tests — fail-closed 429 gates (binding missing / limiter throws / burst→429 / zero-D1-writes) in tests/rate-limit.server.test.ts, tests/demo-proof.rate-limit.test.ts, tests/search.route.test.ts, plus the real-binding integration proof in tests/integration/rate-limit-verified-bot.integration.test.ts.

test-removal-justified: the removed assertions belonged to the D1 fail-open counting mechanism that #2985 deletes for public scopes; the replacement edge Rate Limiting implementation is gated by the new fail-closed burst/missing-binding/limiter-throw/zero-D1-writes tests and the real-binding integration suite.

net-positive-because: not needed — the diff is net-negative overall (public counting moved off D1; ~1000 lines of D1 hot-path limiter deleted).

## Test plan

- CI: vitest node + workers projects, typecheck (cf-typegen regenerates the binding types CI-side), deploy gates.
- First production deploy after merge: confirm the 11 `RL_*` bindings materialize on the deployed worker (wrangler.jsonc `unsafe.bindings` with `simple` capacities), then a manual burst against `/api/demo-proof` / `/search` returning 429 + Retry-After.

loose-ends: the RL_* bindings must be confirmed present on the next deployed worker (config-only until then); the live-URL burst→429 proof needs that deploy, which is CI-gated and not done locally.
