## Stop leaking release identity to anonymous callers (issue #2352)

Gate the `releaseIdentity` field behind the `x-0509-canary-token` header (value: env `CANARY_BYPASS_TOKEN`) in both `app/routes/api.health.ts` and `app/routes/api.health.deep.ts`. Anonymous callers omit the field entirely; both status bodies stay public so the VPS liveness probe and uptime checks keep passing.

### Changes
- `app/routes/api.health.ts` / `app/routes/api.health.deep.ts`: only include `releaseIdentity` when the caller presents a matching `x-0509-canary-token` header. Status/app/checks/timestamp stay public.
- `scripts/prod-canary.lib.mjs`: `checkHealthEndpoint` attaches the canary token, and `runProductionCanary` now forwards its resolved `canaryBypassToken` into each health check, so the tokened deploy canary still reads release identity for deploy-convergence.
- `ops/liveness/0509-liveness-probe.sh`: drop the releaseIdentity assertions; keep asserting public `status`/`app` (shallow) and `status`/`d1`/`scheduledWork` (deep). The no-secrets DynamicUser probe tolerates a missing identity.
- `.github/workflows/uptime-health.yml`: drop worker-version (releaseIdentity) assertions and persistence; assert public `status`/`app`/`checks` only. The workflow has `contents: read` and no secrets, so it cannot present the token.
- Updated the route/liveness/uptime-workflow tests for anonymous-vs-tokened behavior.

### Gate-path note
This PR edits `.github/workflows/uptime-health.yml`, a gate-owned path. I am NOT posting any attestation comment; an admin must attest if required.

### Verification (real runs)
- `npx vitest run --configLoader runner --project node --changed origin/main` -> **7 files, 100 passed**.
- Full node suite `bash ./scripts/ci-vitest-run.sh -- vitest run --configLoader runner --project node` -> **681 files, 8177 passed** (254.7s).
- `sgscan` -> No new security findings (exit 0).
- `bash -n ops/liveness/0509-liveness-probe.sh` -> syntax OK; uptime workflow parses as YAML with `permissions: contents: read`.
- No `migrations/**` or `tests/integration/**` changes in this PR, so the `--project workers` suite is not required.

run-proof: vitest node project — 100 passed (affected-tests mode, `--changed origin/main`) + full node suite 8177 passed.

Test plan:
1. Anonymous `GET /api/health` and `/api/health/deep` return no `releaseIdentity` key (asserted in `tests/api.health.route.test.ts`, `tests/api.health.deep.route.test.ts`).
2. Tokened calls (`x-0509-canary-token` matching `CANARY_BYPASS_TOKEN`) still return `releaseIdentity`.
3. The liveness probe exits 0 on public `status`/`app`/`checks` without identity (asserted in `tests/ops-liveness-probe.test.ts`).
4. `npm test` for the full repo suite.

### Test-reduction justification
The uptime workflow's worker-version evidence steps and the liveness probe's `releaseIdentity`/version assertions were removed because release identity is by design no longer served to anonymous callers: the no-secrets VPS probe and the `contents: read` uptime workflow cannot present the canary token and so must assert only the public `status`/`app`/`checks` contract. The worker-version identity assertion moved to the tokened canary path, which still passes. No assertion was weakened without this scope reason; the four updated test files gained cases (5->7, 4->6, assertions net +7).

### Reviewer round
(product repo gate — filled in before arming)

### Scope trappings
- Stayed strictly inside the allowed files. No new mechanism/script/organ.
- No secret provisioned onto the DynamicUser liveness unit.
- Orchestrator decision (2026-09-10) applied: options resolved, `~~blocked-on: orchestrator~~` struck, `decision-resolved`.

net-positive-because: added lines are test coverage for the new anonymous-vs-tokened gating branches; production files (routes/scripts/probe/workflow) are net-negative and purely remove identity exposure. No new machinery.

loose-ends: none — all six allowlisted files changed, tests green, canary token path preserved.

Closes #2352
