# Lane evidence — claim/issue-3317 (unit pi-issue-0509-3317, issue #3317)

Money-path: the anonymous converting step /auth/signup 429s (one fail-closed
`auth` bucket, 2/60s, covered the page GET plus every /api/auth/* passive
prefetch). Fix: anonymous GET/HEAD auth traffic moves to its own generous
`auth-anon-get` 60/60s per-IP scope (`RL_AUTH_GET`); credential POSTs keep the
tight fail-closed `auth` 2/60s. #3160's brand-page bucket and every other
scope untouched. No migrations/**, no .github/**, no test removed (pure
additions except a 5-line humane429 refactor in rate-limit.server.ts).

## What shipped

- `app/lib/rate-limit.server.ts` — `auth-anon-get` scope (60/60s, keyByIpOnly,
  `RL_AUTH_GET`, `humane429`) for GET/HEAD under /auth/* + /api/auth/*;
  `AUTH_ANON_GET_PER_MINUTE_LIMIT = 60`; humane-HTML 429 body (readable copy,
  Retry-After in header AND copy, noindex, no-store) — the 2026-09-12 walk
  showed the 429 rendering effectively blank.
- `app/lib/env.server.ts` — `RL_AUTH_GET` on `EdgeRateLimitBindingName` +
  `AppEnv` (the CI typecheck gates index both).
- `wrangler.jsonc` / `wrangler.e2e.jsonc` / `tests/integration/wrangler.test.jsonc`
  — RL_AUTH_GET binding, 60/60s, namespace 1012.
- `tests/rate-limit.server.test.ts` (+85) — policy-table lock: the mapping.
- `tests/integration/rate-limit-money-path-signup.integration.test.ts` (+107) —
  real-workerd legs: two-device funnel walk, 24-GET burst zero-429, credential
  POST still 429s (tight 2/60s), flood 429 carries honest-HTML + retry-after 60.
- `scripts/verify-money-path-200s.sh` (+93) — the acceptance-5 live probe:
  fresh session, 4-step walk ×2 devices, then 24 × GET /auth/signup at ≤1 rps;
  exit 0 only when every code is 200; 429s print their Retry-After.

## Run proof (2026-09-13, this unit)

- node: `npx vitest run --configLoader runner --project node tests/rate-limit.server.test.ts` → 38/38, exit 0.
- workers: `npx vitest run --configLoader runner --project workers tests/integration/rate-limit-money-path-signup.integration.test.ts` → 4/4, exit 0 (real workerd, production-mirroring bindings).
- Pre-fix receipt (live 0509.io): `bash scripts/verify-money-path-200s.sh` → walk 14/14 × 200, burst 3×200 / 21×429, every 429 `retry-after: 60`, exit 1 (the detector firing; 0509.io runs the pre-fix limiter until this deploys).
- sgscan (9 touched files): No new security findings, exit 0.

## Pickup proof (2026-09-14, this unit — rebased + re-verified, nothing re-derived)

Prior trail: PR #3325 (head dc78a8b6b) passed every check SUCCESS but was closed
unmerged when its unit died before review+arm; the heartbeat then released the
claim branch (remote reset to main). This pickup inherited the 4 work commits,
verified the mechanisms in code (humane429 HTML keeps retry-after in header AND
copy; the walk script is browser-true), and did NOT re-derive any decision.

- Rebased the 4 commits onto 2026-09-14 main (271a90d87 — #3156's brand-page
  60/60s landed meanwhile in the same files; hunks disjoint, rebase clean,
  brand-page value untouched by this diff — accept-3 re-proven).
- node: tests/rate-limit.server.test.ts → 38/38, exit 0 (VITEST_MAX_WORKERS=2 respected, no coverage, no typecheck — CI owns it).
- workers: tests/integration/rate-limit-money-path-signup.integration.test.ts → 4/4, exit 0 (real workerd, production-mirroring bindings).
- Live pre-fix receipt (this run, 2026-09-14): `bash scripts/verify-money-path-200s.sh` → walk 14/14 × 200, burst 4×200 / 20×429, every 429 `retry-after: 60`, exit 1 — the detector firing, as the issue demands (0509.io still runs the pre-fix 2/60s bucket until this deploys).
- Issue-verify step 2: `curl -sS -o /dev/null -D - https://0509.io/auth/signup | grep -i retry-after` → 200, no retry-after header (bucket recovered; grep no-match, not a failure).
- sgscan (9 touched files): No new security findings, exit 0.
- Namespace-claim verified: wrangler.jsonc carries ratelimit namespaces 1001–1011; this PR's RL_AUTH_GET = 1012 — the mirrors-1001…100N wording is true.
