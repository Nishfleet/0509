## fix(search): guard /auth/login and /auth/signup availability with a 5xx canary

The Sign in / Sign up CTAs on the /search preview are the only conversion path
from the free tier. A 503 on /auth/login or /auth/signup blocks signup at the
moment of first value. This adds an availability canary for those two pages.

### Changes (per accept)

1. **Probe** (`scripts/search-latency-probe.mjs`): after the /search latency
   walk, the probe also fetches `/auth/login` and `/auth/signup`, records each
   page's HTTP status / outcome / elapsed time, and persists them to
   `ops/search-latency/auth.csv` alongside the runs/cards/daily CSVs.
2. **Guard** (`scripts/search-latency-regression-guard.mjs`): a new
   `detectAuthRegression` edge detector reads `auth.csv` and files an issue when
   an auth page returns 5xx (or is unreachable) for 3+ consecutive runs. It is
   an edge detector like the /search guard: one issue per incident, the run
   before the streak must be green.
3. **Tests**: new cases in both test files assert the probe records a non-200
   auth status as a failure (never silently swallowed) and that the guard
   fires/does-not-fire correctly as an edge detector.
4. **Rate limit**: the auth pages are separate endpoints, not counted against
   the anonymous /search budget (20 req / 10 min / IP). They are paced by a
   fixed 1s spacing between the two fetches to stay low-frequency under the
   shared-VPS limit that caused the original transient 503.

### Verification

```
$ npx vitest run --configLoader runner --project node tests/search-latency-probe.test.ts tests/search-latency-regression-guard.test.ts
 Test Files  2 passed (2)
      Tests  24 passed (24)

$ npx vitest run --configLoader runner --project node   # full node suite
 Test Files 607 passed (607)
      Tests 7247 passed (7247)

$ npx vitest run --configLoader runner --project workers  # full workers suite
 Test Files 36 passed (36)
      Tests 183 passed (183)

$ npx tsc -p tsconfig.node.json --noEmit  # strict typecheck, CI gate; search-latency files clean
```

run-proof: live probe against https://0509.io returned 200 for both auth pages
(`auth_availability_probe ... _auth_login_status=200 _auth_signup_status=200
auth_failures=0`) and the /search probe (nike.com) p95=2826ms, 0 errors, 0
rate-limited. This is measurement/observability tooling only — no production
runtime code change.

### Notes

- Accept #4 respected: `/search` rate-limit budget unchanged.
- Prior art / dedupe: #1603 (search-latency-probe) probes /search page-load
  latency only; #1573 added the Sign up CTA without guarding it. No open issue
  covers auth-page 503s.

### Reviewer round

Reviewer seat: `cursor/cursor-grok-4.6-high`. Reviewed `origin/main...HEAD` against the issue acceptance and the repo tests.

- **Act on** — one: CI typecheck (`codex-node-checks`, `preview-assert`) caught strict TS errors in the probe/guard (`authResults`/`authMetricLine` missing from the `runLatencyProbe` return JSDoc type; `authOutcome` implicit-any param; `Map.get` possibly-undefined in `detectAuthRegression`). Fixed in a follow-up commit; typecheck now clean for the changed files.
- **Noted** — both-regressions-fire JSON path omits the auth issue `created` URL (guard `main()` when a `/search` and an auth regression fire in the same run). Production/non-JSON path reports both titles; the JSON branch is a replay aid only. Deferred, not blocking.
- **Noted** — auth statuses persisted to sibling `auth.csv` + `auth_availability_probe` metric line rather than literally inside runs.csv rows (criterion 1 intent — status recorded, not lost — is met; separate schema is cleaner).
- **Noted** — criterion 4 satisfied by construction: `/auth/*` routes hit a separate `auth` rate-limit scope (20 req/10min), never the `public-search` budget.
- **Noted** — 4xx on an auth page is classified `ok` (misconfiguration, not a transient outage); 5xx/transport errors are the failures, matching the guard's 5xx detection.
- **Consider** (not adopted this round) — `redirect: "follow"` to record the final redirect-target status; assert exact 1s auth spacing in the pacing test; drop the cosmetic leading underscore in `formatAuthAvailabilityLine` metric keys. These are hardening, outside the acceptance bar.

Closes #1692
