## Stop leaking release identity to anonymous callers (issue #2352)

Gate the `releaseIdentity` field behind the `x-0509-canary-token` header (value: env `CANARY_BYPASS_TOKEN`) in both `app/routes/api.health.ts` and `app/routes/api.health.deep.ts`. Anonymous callers omit the field entirely; both status bodies stay public so the VPS liveness probe and uptime checks keep passing.

### Changes
- `app/routes/api.health.ts` / `app/routes/api.health.deep.ts`: only include `releaseIdentity` when the caller presents a matching `x-0509-canary-token` header. Status/app/checks/timestamp stay public.
- `scripts/prod-canary.lib.mjs`: `checkHealthEndpoint` attaches the canary token so the tokened deploy canary (and gate-c-soak `verifyLiveIdentity`, which reuses it) still reads release identity for deploy-convergence.
- `ops/liveness/0509-liveness-probe.sh`: drop the releaseIdentity assertions; keep asserting public `status`/`app` (shallow) and `status`/`d1`/`scheduledWork` (deep). The no-secrets DynamicUser probe tolerates a missing identity.
- `.github/workflows/uptime-health.yml`: drop worker-version (releaseIdentity) assertions and persistence; assert public `status`/`app`/`checks` only. The workflow has `contents: read` and no secrets, so it cannot present the token. Deploy-convergence identity evidence now lives in the tokened canary path (`checkHealthEndpoint`/`gate-c-soak`).
- Updated the route/liveness/uptime-workflow tests for anonymous-vs-tokened behavior.

### Gate-path note
This PR edits `.github/workflows/uptime-health.yml`, a gate-owned path. I am NOT posting any attestation comment; an admin must attest if required.

### Verification (real runs)
- `npx vitest run --configLoader runner --project node tests/api.health.route.test.ts tests/api.health.deep.route.test.ts tests/ops-liveness-probe.test.ts tests/uptime-health-workflow.test.ts tests/prod-canary.test.ts` → 5 files, 45 passed.
- `--project node tests/verify-post-deploy-release.test.ts tests/gate-c-soak.test.ts tests/launch-readiness.route.test.ts` → 3 files, 61 passed.
- `--project node --changed origin/main` → 7 files, 100 passed (run-proof: vitest run, `Test Files 7 passed / Tests 100 passed`).

run-proof: vitest node project — 100 passed (affected-tests mode, `--changed origin/main`) at 21:29:37Z.

### Test-reduction justification
The uptime-engine `Worker-version` evidence steps and the liveness probe's `releaseIdentity`/version assertions were removed because release identity is now (by design, per the orchestrator decision) not served to anonymous callers: the no-secrets VPS probe and the `contents: read` uptime workflow cannot present the canary token and so must assert only the public `status`/`app`/`checks` contract. The worker-version identity assertion moved to the tokened canary path, which still passes. No assertion was weakened without this scope reason.

### Reviewer round
(reviewer seat filled after open — product repo)

### Scope trappings
- Stayed strictly inside the allowed files. No new mechanism/script/organ.
- No secret provisioned onto the DynamicUser liveness unit.
- Orchestrator decision (2026-09-10) applied: options resolved, `~~blocked-on: orchestrator~~` struck, `decision-resolved`.

net-positive-because: the added lines are all test coverage (+159 across the four updated tests) for the new anonymous-vs-tokened gating branches; production files (routes/scripts/probe/workflow) are net-negative (-43) and purely remove identity exposure. No new machinery.

Closes #2352