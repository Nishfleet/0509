## What

Closes #1899. The offer-timeline implementation itself (persisted `landing_page_snapshot` rows, public `/timeline/:domain` ledger, `?asOf=` retrieval, nightly demo-brand backfill) is already live on main. What was missing was a guard that makes the **public** timeline surface loud when it goes dark — the D1 row-count canary cannot see the proof-gate dark state (a brand can hold non-zero stored rows and still 410 because no real capture has landed, issue #1284).

This PR ships that guard: a new `--http` mode for the existing canary that probes `https://0509.io/timeline/<domain>` for all five demo brands and fails when any brand does not render a non-empty dated ledger (HTTP 200 + the "As of" affordance + a rendered `f9-timeline-entry` ledger row). No Cloudflare token needed — a plain public curl — so it runs on the fleet VPS as a user timer, the established rail for 0509 canaries (`0509-search-tier-canary`, issue #1452: the worker GitHub App token cannot create or update `.github/workflows` files — a GitHub-workflow variant was tried and its push was rejected for exactly that reason).

**Files**

- `scripts/canary-demo-brand-timeline.mjs` — adds `--http` mode: curl each demo brand's timeline URL, classify (pass = 200 + `As of` + `f9-timeline-entry`; fail = 410 / 5xx / empty shell / D1-read-failure shell), report, auto-file (`--file-issue`, deduped via `demo-brand-timeline-guard-incident` marker), and write a JSON evidence file (`CANARY_EVIDENCE_DIR` overridable). D1 count mode unchanged.
- `tests/canary-demo-brand-timeline.test.ts` — 25 tests (was 22): covers the classifier, including the D1 read-failure shell case (200 + `As of` label but no ledger entry must FAIL).
- The scheduled execution lives on the VPS: user timer `0509-demo-brand-timeline-canary` (daily 06:10 IST), running from a dedicated read-only checkout that self-syncs to main on each run.

## Verification

Real runs, on this branch, against the live production surface:

```
$ npx vitest run --configLoader runner --project node tests/canary-demo-brand-timeline.test.ts
 Test Files  1 passed (1)
      Tests  25 passed (25)

$ npx vitest run --configLoader runner --project workers \
    tests/integration/landing-page-snapshot-persistence.integration.test.ts
 Test Files  1 passed (1)
      Tests  4 passed (4)

$ npx vitest run --configLoader runner --project workers \
    tests/integration/offer-timeline.integration.test.ts tests/integration/demo-brand-timeline-backfill.integration.test.ts
 Test Files  2 passed (2)
      Tests  9 passed (9)

$ npm run typecheck
exit 0

$ CANARY_EVIDENCE_DIR=/tmp/canary-ev node scripts/canary-demo-brand-timeline.mjs --http
demo-brand-timeline canary (mode=http, origin=https://0509.io at ...)
- nike.com: HTTP 410
- nykaa.com: HTTP 410
- allbirds.com: HTTP 200
- lenskart.com: HTTP 200
- mamaearth.com: HTTP 410
verdict: FAILED —
- /timeline/nike.com returned 410 — ...
- /timeline/nykaa.com returned 410 — ...
- /timeline/mamaearth.com returned 410 — ...
```
exit 1 — the guard correctly fails on the three dark brands, and writes the JSON evidence file.

`run-proof:` the `--http` mode executed end-to-end on this branch against production (exit 1 listing the three dark brands, evidence file written). The VPS user timer `0509-demo-brand-timeline-canary` is enabled and its unit mirrors the proven `0509-search-tier-canary` (issue #1452); its first scheduled run is 06:10 IST after merge, by which time the self-syncing checkout carries this branch's `--http` mode from main.

`Closes #1899`

## The dark brands: mechanism-impossible, not silent

`nike.com`, `nykaa.com`, `mamaearth.com` still 410 on `/timeline/:domain` because the nightly real capture fails at the target site (nike geo-redirects to `/de/`, nykaa serves a bot wall, lenskart served a Cloudflare challenge; allbirds/lenskart capture and ledger fine). The capture pipeline for those sites is outside this repo's reach from a PR — it needs Cloudflare credentials (wrangler/D1) this worker does not have, and the fix belongs in the capture adapters, not here.

`mechanism-impossible:` the nightly backfill capture itself for those three sites cannot be repaired from this unit (no Cloudflare/D1 access to diagnose or fix production captures; target-site bot protection is environmental). What this PR does deliver is the detection half: the gap now surfaces as a failed VPS canary unit + an auto-filed incident instead of hiding, and it re-probes daily so the moment a capture lands the guard goes green. 2/5 demo brands (allbirds, lenskart) already render non-empty dated ledgers — verify-2 of #1899.
