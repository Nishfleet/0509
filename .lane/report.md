# MONEY silent-failure remediation

## Scope

- C7: paid evidence top-ups could be read as zero when D1 queries failed.
- C9: search-selection spend admission returned before the durable, atomic claim completed.
- M3: monitoring plan lookup failures silently defaulted paying workspaces to the fastest cadence.

Only MONEY-group implementation and regression-test files were changed. No schema, lockfile, deployment configuration, provider resource, or UI copy was changed.

## Failing-first evidence

Command:

```text
flock --exclusive --wait 10800 /home/nish/.local/state/0509/deploy-window.lock \
  npm test -- tests/evidence-usage.test.ts \
  tests/plan-proof-usage-failure.test.ts \
  tests/rate-limit.server.test.ts \
  tests/monitoring-scheduled-runtime.test.ts
```

Baseline result: **5 failed, 60 passed**.

- C7 summary probe expected the top-up read to reject; it instead returned an ordinary summary with `topUpRemaining: 0`.
- C7 history probe expected the read to reject; it instead returned `[]`.
- C7 plan-summary probe expected the top-up failure to propagate; it instead returned the legacy exhausted/zero path.
- C9 probe expected spend admission to complete before returning; `waitUntil` was called once.
- M3 probe expected a plan-read failure to suppress unsafe scheduling; all 27 watchlists were eligible.

## Cause-level remediation

- C7 now distinguishes top-up read failure from a legitimate empty result with a typed error, propagates that error through proof-usage aggregation, and no longer converts a second legacy-store read failure into zero.
- C9 marks search-selection admission as an atomic claim so the existing rate-limit primitive awaits the durable write before granting spend.
- M3 now excludes only workspaces whose plan cannot be read, preserves work for healthy workspaces, and throws after fan-out so the scheduled observer records an honest failure instead of a false no-work success.

Cloudflare D1 behavior was checked against the official prepared-statement, return-object, limits, and database concurrency documentation. The fix relies on documented serial statement execution and treats query rejection as operational failure, not an empty successful result.

## Verification

| Gate | Result |
| --- | --- |
| Lock-wrapped `npm ci` | PASS — 293 packages installed; 294 audited; 0 vulnerabilities |
| Failing-first probes | PASS as evidence — 5 expected failures, 60 passes before implementation |
| Focused MONEY regression suite | PASS — 6 files, 84 tests |
| Lock-wrapped full Vitest | PASS — 385 files, 4,167 tests |
| Lock-wrapped typecheck | PASS — Wrangler type generation, React Router type generation, and `tsc -b` |
| Gate-B local release | PASS — 73/73, strict, 0 failures, 0 retries, 0 first-attempt failures, 254 artifacts |
| `sgscan --baseline-commit HEAD` | PASS — no new security findings |
| `crgate --agent --include-untracked` | `crgate: rate-limited, skipped` — free tier was 3/3; no force override |
| Greptile GitHub review | Informational — trial account has reached its 50-credit limit; no code finding produced |
| `bugbot-gate status` | `SKIP BUGBOT` — risk `normal`; ordinary code/content diff; use cheaper checks first |

Gate-B covers the canonical journey and content-sanity ugly states. No user-facing copy changed in this lane.

Gate-B manifest:

```text
test-results/gate-b-manifest-local-release-local-10da1228723ed4ea61d0a49b731c4477.json
candidateFingerprint: 909d390fd7c0f32776db2c363eac0d14be9cacb7a57439f1c871fd1435693c30
serverIdentity: local-10da1228723ed4ea61d0a49b731c4477
manifestSha256: f1cf6295a6533c407c861984114590733d1cd036e5f308c6e3a1870714b5516b
```

## Delivery

- Branch: `fix/silent-fixmoney`
- Pull request: https://github.com/nish3451/0509/pull/445
- Merge: not performed

The GitHub-installed Bugbot hook ran independently of this lane command and returned a neutral usage-limit result. The lane did not invoke Bugbot directly and followed the `bugbot-gate status` decision above.
