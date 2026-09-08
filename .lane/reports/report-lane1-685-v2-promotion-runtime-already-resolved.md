# Lane 1 — PR #685 v2 promotion in runtime: already live in production (re-verified)

**Item**: PR #685's v2 promotion is in the commit but NOT in the runtime: worker
`1dec2c91` (head SHA `40e718ce`, wrangler.jsonc).

**Verdict**: Already resolved on `origin/main`. PR #685 (`70faea05`,
"feat(search): promote public search from shadow to v2 rollout", merged
2026-08-12) is the resolving commit, and the live production worker
currently serves `searchRolloutMode: "v2"` on both public health
endpoints. Evidence record only; no product code touched.

## Live evidence (this lane's re-verification, 2026-08-14)

`curl -sS --max-time 20 https://0509.io/api/health` →

```json
{"status":"ok","app":"0509","timestamp":"2026-08-14T20:50:53.496Z","releaseIdentity":{"workerVersionId":"11659201-9cc0-4a75-9c4c-e1622d16055e","tag":null,"timestamp":"2026-08-14T18:54:49.887395Z","searchRolloutMode":"v2"}}
```

`curl -sS --max-time 20 https://0509.io/api/health/deep` →

```json
{"status":"ok","app":"0509","timestamp":"2026-08-14T20:50:55.270Z","checks":{"edge":"ok","d1":"ok","scheduledWork":"ok"},"releaseIdentity":{"workerVersionId":"11659201-9cc0-4a75-9c4c-e1622d16055e","tag":null,"timestamp":"2026-08-14T18:54:49.887395Z","searchRolloutMode":"v2"}}
```

Both endpoints return status 200 and `searchRolloutMode: "v2"` on the
live worker `11659201-9cc0-4a75-9c4c-e1622d16055e` (deployed
2026-08-14T18:54:49Z), which superseded the previously-flagged worker
`1dec2c91` (built from `40e718ce`). The flagged worker is no longer the
live traffic-serving version.

## Evidence on current main (HEAD `b21cc135`)

- `git merge-base --is-ancestor 70faea05 HEAD` → 0 (PR #685 is an
  ancestor of the current main HEAD).
- `wrangler.jsonc` line 81: `"SEARCH_ROLLOUT_MODE": "v2"` — attributed
  to `70faea05` (PR #685) via `git log -S`.
- `wrangler.e2e.jsonc` line 18: `"SEARCH_ROLLOUT_MODE": "v2"` — same
  attribution.
- `git show 40e718ce:wrangler.jsonc` already returns `v2` because
  `70faea05` is an ancestor of `40e718ce`; the earlier worker
  `1dec2c91` flagged in the item text predates the current production
  worker and is no longer the live traffic-serving version.
- Every release-tooling gate PR #685 updated now requires `v2` on this
  tip (`scripts/customer-readiness-candidate.mjs:363`,
  `tests/prod-canary.test.ts:10`,
  `tests/api.health.deep.route.test.ts:44-67`,
  `tests/api.release-soak.route.test.ts:139`,
  `.github/workflows/uptime-health.yml:49` and `:114`).

## History

Prior lane evidence (commit `1dcaaa67`, branch
`report/lane1-685-v2-promotion-runtime-already-resolved`, 2026-08-14)
documented the same verdict with worker `b414ab47-cfef-4f65-91f2-a213c8393c27`
(deployed 2026-08-13T14:46:24Z). This record extends that evidence
through the current live worker (`11659201`, deployed 2026-08-14).

## Verification

- Two live curls above (one per endpoint), both 200 with
  `searchRolloutMode: "v2"`.
- `git diff --check` clean (markdown-only change).
- No file in `app/`, `workers/`, `scripts/`, `wrangler.jsonc`,
  `wrangler.e2e.jsonc`, or `.github/workflows/` was modified by this
  lane. This lane adds `.lane/reports/report-lane1-685-v2-promotion-runtime-already-resolved.md`
  only.

## Files

- `.lane/reports/report-lane1-685-v2-promotion-runtime-already-resolved.md` —
  evidence record only; no product code touched.
