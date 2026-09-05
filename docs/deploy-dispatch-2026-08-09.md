# Production deploy dispatch — 2026-08-09

## Dispatch

- **Workflow**: `.github/workflows/deploy-production.yml` (`Deploy production`)
- **Run**: https://github.com/Nishfleet/0509/actions/runs/31298895978
- **Event**: `workflow_dispatch`
- **Ref**: `refs/heads/main`
- **`expected_sha`**: `25392ca2ae77dbf48f7e7df80337fb1be8c3677c` (current `origin/main`)
- **`backup_proof_status`**: `required`
- **`deferred_backup_authorization`**: empty

## Why a dispatch was needed

A prior dispatch for `d863fd18` (run 31297786931) was aborted at the provider-main
CAS gate with `provider_main_cas_invalid: remote_main_drift` — `main` moved to
`25392ca2` while that deploy ran. The workflow fails closed by design, so the fix
is to re-dispatch against the current main tip, which this run does.

## Customer fixes leaving the queue with this deploy

- #548 — brand pages stop claiming "right now"/"live" on stale captures
- #547 — lease waiter no longer blocks the first anonymous query for an uncached advertiser
- #546 — digest named owner, materiality reason, and next action on every brief

## Result

- **Run**: https://github.com/Nishfleet/0509/actions/runs/31319791367 (succeeded 2026-08-09)
- **Deployed version**: `24e18f13-f932-4b23-a6c1-d0eb218747f0` (gate C `passed: true`)
- **CAS**: `provider_main_cas_invalid: remote_main_drift` aborted this dispatch's deploy run (31298895978) after a fully green readiness gate — the same drift failure described above. The follow-up deploy run at 31319791367 (also against `25392ca2`'s main) shipped the customer fixes.

## Follow-up verification (lane 9, 2026-08-10)

- **Code**: `d863fd18` (#548) is in `origin/main` and in the deployed build (live asset `ads._domain-M5AcxIWf.js` serves `freshForLiveClaim` gating). `BRAND_PAGE_LIVE_CLAIM_MAX_AGE_MS = 1h`; every "right now"/"live"/"Running right now" phrase on `/ads/:domain` is gated on `freshForLiveClaim`, and stale captures render past-tense copy with a "checked …" stamp.
- **Live checks** (2026-08-10 ~18:32 UTC, capture stamps in JSON-LD `dateModified`):
  - `https://0509.io/ads/nykaa.com` — capture `18:07:18Z` (25 min old): "right now" is honest and present.
  - `https://0509.io/ads/adidas.com` — capture `15:42:41Z` (2h49m old): no "right now"; title says "checked about 2 hours ago".
  - `https://0509.io/ads/nike.com` — capture `15:42:45Z` (2h49m old): no "right now"; title says "checked about 2 hours ago".
- **Conclusion**: item resolved; no code change required. This entry documents the evidence.
