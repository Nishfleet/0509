# Public search "right now" promise — reverify: gate proven live, plus canary hardening for the deploy-lag defect class

**Status: gate verified working on live production; a live deploy-lag defect on
the flagship proof surface (the `nykaa.comin` gluing) is now caught by the
deploy canary so it can never silently ship again.**

Branch: `0509-lane1-fresh-live-gate-reverify-2026-08-21`
Base: `origin/main` at `422fbd55` (#806)

## Item

- [ ] Gate public search's "right now" promise on a proven fresh-live Ad Library
      capture [scout 2026-08-09, risk: green]

## Verdict

The gate is **implemented, merged (PR #567), and proven working on live
production**. This lane re-verifies at the current tip and adds one hardening
change: the deploy canary now fails any release that would serve the
glued-domain defect (`nykaa.comin`) that this reverify found **still live** on
`0509.io` despite the fix being merged to main.

## Evidence: the gate holds on live production (2026-08-20 21:30 UTC)

Probed with cache-busted requests (`Cache-Control: no-cache` + unique query
param) so no edge cache could mask the worker's true behavior:

- **`https://0509.io/api/demo-proof`** — capture `fetchedAt
  2026-08-20T20:49:45.253Z` (~40 min old at probe time): `freshForLiveClaim:
  false`, subject `12 of 12 cached ads are active on record` (past tense), and
  freshness `Last checked about 40 minutes ago — captured Aug 20, 8:49 PM`.
  The "right now" claim is correctly absent on an older capture.
- **`https://0509.io/ads/nykaa.com`** — `<title>` is `Nykaa: Meta ads linking
  to nykaa.com and more matching it — checked about 41 minutes ago | Five to
  Nine`: no "right now" on an older capture, honest checked-ago stamp.
- **`https://0509.io/search`** (idle) — renders "Nothing searched yet"; no
  "right now" or "running on Meta right now" anywhere in the idle state.

The `isProvenFreshLiveCapture` predicate (`app/lib/search-display.ts`) is the
single gate behind fresh/live wording: true only for a cache miss on a healthy,
non-partial, non-demo provider check. Verified on this branch:

```
$ npx vitest run tests/search-live-claim.test.tsx tests/ads-brand-page.render.test.tsx tests/ads-brand-page.signals.test.ts tests/public-proof-summary.test.ts tests/marketing-proof-brief.test.tsx
 Test Files  5 passed (5)
      Tests  56 passed (56)
```

## Evidence: the live defect this reverify caught

The homepage proof brief — the flagship real-proof surface — serves:

> 12 public Meta ads link to nykaa.comin the Meta Ad Library. Every source
> below opens the same page any visitor can open.

`nykaa.comin` is the exact defect class commit `422fbd55` (PR #806, merged to
main 2026-08-21 00:13 +0530) claims to have killed. Root cause is **deploy
lag, not code**: the checked-in `buildSummary` in `app/lib/public-proof.server.ts`
has the separator fix (`${input.website} ${countryPhrase}`), and the 56-test
suite including the new `tests/public-proof-summary.test.ts` passes — but the
live worker still serves the old string. GitHub deploy records for `422fbd55`
(20:41–21:12 UTC) carry `success` deployment statuses, yet the last
`conclusion: success` deploy run was `59243e7f` (15:01 UTC, before the fix
merged), so the fix never actually shipped to the running worker. Nothing in
the deploy pipeline noticed, because the live canary only checked the homepage
for old-copy signals and did not include the defect string.

## Change shipped by this lane

- **`scripts/check-live-public-home.mjs`** — added `"nykaa.comin"` to
  `staleSignals`. This canary runs as the `live_public_truth` step of the
  deploy plan (`scripts/deploy-production-plan.mjs`), so any deploy whose live
  worker would serve the glued-domain string now hard-fails the release gate.
  Proven against live production: the canary now exits 1 with
  `stale: ["nykaa.comin"]` on both probed URL variants, i.e. it catches the
  exact defect this reverify found. The anti-drift coupling test
  (`tests/worker-security-headers.test.ts`) only imports the cache-control
  constants and passes (18/18).

The canary change is deliberate and minimal: a stale-signal list entry cannot
change any behavior for a healthy site (the string never legitimately appears),
and it makes the "deploy lag silently ships old proof copy" failure mode
impossible going forward.

## Files

- `scripts/check-live-public-home.mjs` — canary stale-signal hardening.
- `.lane/reports/0509-lane1-fresh-live-gate-reverify-2026-08-21.md` — this
  evidence record.

## Rollback

Remove the `"nykaa.comin"` entry from `staleSignals` in
`scripts/check-live-public-home.mjs`. No data, billing, or product behavior
change.
