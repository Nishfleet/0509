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

## Follow-up (2026-09-14 ~11:00Z) — deploy pipeline blocker

PR #3488 merged 10:18Z but never reached production: every
`deploy-production.yml` run since 09:56Z fails at the `Test` step on
`tests/sitemap-coverage-guard-provision.test.ts` (introduced by #3475 for
issue #3166, merged over a red `codex-node-checks-shard-2`). Failed runs:
34830559963, 34832681451, 34833352325, 34834157339.

Root cause of the test failure: the drill ran the real
`provision-sitemap-coverage-guard.sh --resolve-path` against the host's own
layout and asserted a single candidate dir containing BOTH node and gh. True
on the VPS (`~/.local/bin`), impossible on `ubuntu-latest` — node resolves in
hostedtoolcache, gh in `/usr/bin`, so `resolve_node_bin_dir` correctly found
no both-tools dir and exited 1 (all four `--resolve-path` assertions red at
lines 23/35/60/72 of the original file).

Fix (this PR): the test now builds a `$HOME` fixture per case — a DECOY
`$HOME/.local/bin/node` with no gh (the stale-binary failure mode the
resolver exists to skip) and the real node+gh pair in `$HOME/bin`. The
resolver's candidate order makes the outcome deterministic on any host with
node and gh installed, and the picked dir is asserted to be exactly
`$HOME/bin` — the decoy-skip coverage is stronger than before, not weaker.
The provision script itself is untouched: failing loud on a host without the
precondition is correct behavior for VPS provisioning tooling.

Runs:

```
npx vitest run tests/sitemap-coverage-guard-provision.test.ts --reporter=dot
  Test Files 1 passed (1) / Tests 7 passed (7)

npx vitest run --configLoader runner --project node --changed origin/main --reporter=dot
  Test Files 1 passed (1) / Tests 7 passed (7)
```

Remaining accept gate is unchanged: a green `deploy-production` run, a
`0 */3 * * *` monitoring tick writing `website_site_scan` rows, then the
next `meta-discovery-canary` scheduled run (`23 */3 * * *`).

## Close-out (2026-09-14 ~16:00Z) — both acceptance conditions met on live evidence

The remaining gate cleared end to end after this record was written:

1. **Deploy green.** `Deploy production` run 34849114422 (2026-09-14T13:25Z,
   carries #3488's fix) succeeded; run 34852199275 (13:54Z, main tip
   `eae7acac5`) also succeeded — current main is fully deployed.
2. **Rows landing.** `Meta discovery canary` run 34846932941 (scheduled
   2026-09-14T13:03:54Z): `node scripts/check-d1-fullsite-runs.mjs` in remote
   mode printed `website_site_scan rows: 21` and
   `verdict: ok — full-site scans are landing rows.` Every prior canary run
   in the listing (2026-09-12T23:05Z through 2026-09-14T05:08Z) was red on
   0 rows, so the flip is real, not flake.
3. **Canary green.** Same run 34846932941 is the first green
   `meta-discovery-canary` on main since the regression — `fullsite-runs`
   and `meta-readiness` both success.

Full landed chain: **#3488** (root fix — the site scan runs in its own
`withRunLease` before `scan()` resolves; provider rethrows can no longer skip
the insert, and gated scans emit `fullsite_watch_scan_skipped`),
**#3495** (host-independent provision drill unblocking deploy CI), **#3517**
(Nish — renumbered `0098_competitor_suggestion_dismissal.sql` → `0104`,
closing the append-only ledger hole that kept every deploy red). PR #3520
(declared-order exception approach) was closed as superseded by #3517 — its
diff would have re-created the hole.

Inference, flagged as such: the 21 rows landed on the 12:00Z scheduled tick
while production still ran pre-#3488 code — this cycle the provider took the
degraded-payload path (#3103's fix) rather than rethrowing, so the
post-`scan()` block executed and wrote. The merged fix removes the rethrow
mode entirely, so future provider outages cannot starve the manifest.

This PR closes the issue: the only missing step was a merged PR carrying the
close keyword — #3488 used a merge commit whose auto-close did not fire.
