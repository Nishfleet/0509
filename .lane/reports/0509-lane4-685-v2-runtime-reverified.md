# Lane 4 — PR #685 v2 promotion in runtime: already live in production (re-verified 2026-08-21)

**Item**: PR #685's v2 promotion is in the commit but NOT in the runtime: worker
`1dec2c91` (head SHA `40e718ce`, wrangler.jsonc).

**Verdict**: Already resolved on `origin/main` and confirmed live in
production on the current worker. PR #685 (`70faea05`, "feat(search):
promote public search from shadow to v2 rollout", merged 2026-08-12)
is the resolving commit. The live production worker now serves
`searchRolloutMode: "v2"` on every public health endpoint. Evidence
record only; no product code touched.

## Live evidence (this lane's fresh re-verification, 2026-08-21)

`curl -sS --max-time 20 https://0509.io/api/health` →

```json
{"status":"ok","app":"0509","timestamp":"2026-08-20T22:23:22.401Z","releaseIdentity":{"workerVersionId":"0097fc57-c27d-4097-88dc-0862ede8d683","tag":null,"timestamp":"2026-08-20T15:34:04.467444Z","searchRolloutMode":"v2"}}
```

`curl -sS --max-time 20 https://0509.io/api/health/deep` →

```json
{"status":"ok","app":"0509","timestamp":"2026-08-20T22:23:23.715Z","checks":{"edge":"ok","d1":"ok","scheduledWork":"ok"},"releaseIdentity":{"workerVersionId":"0097fc57-c27d-4097-88dc-0862ede8d683","tag":null,"timestamp":"2026-08-20T15:34:04.467444Z","searchRolloutMode":"v2"}}
```

`curl -sS --max-time 20 https://www.0509.io/api/health` →

```json
{"status":"ok","app":"0509","timestamp":"2026-08-20T22:23:24.052Z","releaseIdentity":{"workerVersionId":"0097fc57-c27d-4097-88dc-0862ede8d683","tag":null,"timestamp":"2026-08-20T15:34:04.467444Z","searchRolloutMode":"v2"}}
```

`curl -sS --max-time 20 https://api.0509.io/api/health` →

```json
{"status":"ok","app":"0509","timestamp":"2026-08-20T22:23:24.154Z","releaseIdentity":{"workerVersionId":"0097fc57-c27d-4097-88dc-0862ede8d683","tag":null,"timestamp":"2026-08-20T15:34:04.467444Z","searchRolloutMode":"v2"}}
```

All four public health endpoints return HTTP 200 with
`searchRolloutMode: "v2"` on the live worker `0097fc57-c27d-4097-88dc-0862ede8d683`
(deployed `2026-08-20T15:34:04.467Z`), which is a separate, post-dated
build that fully supersedes the previously-flagged worker `1dec2c91`
(built from `40e718ce`). The flagged worker is no longer the live
traffic-serving version.

## Evidence on current `origin/main` (HEAD `422fbd55`)

- `git merge-base --is-ancestor 70faea05 HEAD` → exit 0 (PR #685 is an
  ancestor of the current main HEAD).
- `git show 40e718ce:wrangler.jsonc` already returns `"SEARCH_ROLLOUT_MODE": "v2"`
  because `70faea05` is an ancestor of `40e718ce`; the earlier worker
  `1dec2c91` flagged in the item text predates the current production
  worker and is no longer the live traffic-serving version.
- `wrangler.jsonc` line 81: `"SEARCH_ROLLOUT_MODE": "v2"` — attributed
  to `70faea05` (PR #685) via `git log -S 'SEARCH_ROLLOUT_MODE'`.
- `wrangler.e2e.jsonc` line 18: `"SEARCH_ROLLOUT_MODE": "v2"` — same
  attribution.
- Release-tooling gates that PR #685 updated now require `v2` on this
  tip (the `customer-readiness-candidate.mjs`, `prod-canary`,
  `gate-c-soak`, deploy-readiness, remote-restore evidence, uptime-health
  workflow, and release-soak route surfaces all enforce the v2 identity).

## History

- Lane 1 prior re-verification `cfe99f38` on `report/lane1-685-v2-promotion-runtime-already-resolved`
  documented the same verdict; the then-live worker was
  `11659201-9cc0-4a75-9c4c-e1622d16055e` (deployed 2026-08-14).
- This lane record extends that evidence through the live worker
  `0097fc57-c27d-4097-88dc-0862ede8d683` (deployed 2026-08-20) on a
  current main HEAD of `422fbd55`.

## Verification

- Four live curls above (one per endpoint and `www` / `api` variants),
  all 200 with `searchRolloutMode: "v2"`.
- `git diff --check` clean (markdown-only change).
- No file in `app/`, `workers/`, `scripts/`, `wrangler.jsonc`,
  `wrangler.e2e.jsonc`, or `.github/workflows/` was modified by this
  lane. This lane adds
  `.lane/reports/0509-lane4-685-v2-runtime-reverified.md` only.

## Files

- `.lane/reports/0509-lane4-685-v2-runtime-reverified.md` — evidence
  record only; no product code touched.

## Deliverables

- Branch `0509-lane4-685-v2-runtime-reverified` pushed; PR opened on
  `origin/main`.
- Evidence record committed on the lane branch; lane claims published
  to `/home/nish/workspaces/agent-state/lanes/0509/lane-4.json`.

## Rollback

N/A — evidence-only change.
