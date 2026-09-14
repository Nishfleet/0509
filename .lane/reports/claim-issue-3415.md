# Triage report — claim/issue-3415

Issue `Nishfleet/0509#3415`: `website_site_scan` reports 0 rows past grace —
scheduled full-site scan path silently dead in production.

## Root cause

`runWatchlist` (`app/lib/monitoring.server.ts`) ran the Full-Site Watch block
inside the post-`scan()` `withRunLease` effect phase — i.e. only after
`await scan()` resolved. In `searchAdsViaSourceResolver`
(`app/lib/ad-source.server.ts`, the `throw error` tail of the failure path),
a `watchlist_scan` run with `forceLive: true` and no customer Meta token gets
**no** Meta-API fallback (`!forceLive || customerMetaAdLibraryToken` gate) and
no cache serve — the provider error **rethrows**. Any sustained browser-scrape
outage therefore skipped the site-scan block on every claimed scheduled run:
the run recorded the provider failure while `website_site_scan` stayed
permanently empty. `metaAdsBeta.ok` stays green throughout because
`public_search` traffic takes the degraded-payload return, not the rethrow —
so the canary liveness evidence never contradicted the site-scan death.

This is the same structural hole as #3103 (cache-only `degraded` throw
suppressing the scan) one failure mode deeper: #3103 moved the block before
the `if (degraded) throw`, but it still sat behind `await scan()` itself.

Ruled out during trace: binding name (`MONITORING_WORKFLOW` wired in
`wrangler.jsonc`, workflow class dispatches to `runWatchlistWorkflowJob`),
missing remote migration (0077 schema preserved verbatim through 0087's
copy/restore, INSERT column list matches), queue drop (fan-out mode `fanout`,
`MONITORING_FANOUT_GLOBAL=1`, claim/dispatch status transitions consistent),
token rotation (`renewOrchestratedWatchlistRunLease` preserves the token).

Remote D1 reproduction was not possible from this worker — `wrangler` is not
authenticated here (`You are not authenticated. Please run wrangler login.`).
All verification below is code-level against real local D1 (workerd project).

## Fix

`app/lib/monitoring.server.ts`:

- The Full-Site Watch block now runs **before** `await scan()`, inside its own
  `withRunLease` fence. The site scan fetches sitemaps/robots/pages directly
  and shares nothing with the ad discovery provider, so neither a cache-only
  cooldown (#3103) nor a hard provider throw (#3415) can suppress the manifest.
  Site-scan errors remain non-fatal (structured `fullsite_watch_scan_failed`
  log, run continues); a `StaleOrchestratedWatchlistRunError` from the fence
  still propagates and aborts the run.
- `runWebsiteSiteScanForWatchlist` gate skips were previously silent — a scan
  gated out left no trace, making an ineligible rollout indistinguishable from
  a broken write path. Each gate now emits a structured
  `fullsite_watch_scan_skipped` event with reason
  (`no_public_website_url` / `host_not_in_canary_allowlist` /
  `no_processing_token`).

## Evidence

`tests/integration/website-site-scan-write.integration.test.ts` (workerd
project, real local D1):

- NEW: `still lands a manifest row when the ad scan throws before returning —
  issue #3415 regression` — a `scan()` that throws `CommercialDiscoveryError`
  must still leave a `website_site_scan` row for the claimed run.
  **Red before the fix** (`expected null not to be null`), green after.
- Existing #3103 manifest + degraded-manifest tests stay green.

Runs:

```
npx vitest run --project workers tests/integration/website-site-scan-write.integration.test.ts
  Test Files  1 passed (1) / Tests 3 passed (3)

npx vitest run --configLoader runner --project node --changed origin/main
  Test Files  88 passed (88) / Tests 1028 passed (1028)
```

## Acceptance status

- `node scripts/check-d1-fullsite-runs.mjs` remote mode reports rows > 0 —
  **requires an authenticated environment** (wrangler login unavailable in
  this worker). After this deploys, the next claimed scheduled run of any
  eligible watchlist writes the manifest before the ad provider is consulted;
  if rows remain 0, the new `fullsite_watch_scan_skipped` log lines name the
  gate that kept the workload out.
- Next Meta discovery canary on main green — post-merge, CI-owned.
