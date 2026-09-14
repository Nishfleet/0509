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

## Follow-up 2 (2026-09-14 ~13:00Z) — production D1 migration ledger hole

The sitemap-drill fix landed (#3495 + #3503/#3510 fixture-HOME drills), but
deploys kept failing — now one step later, at `generate_restore_evidence` /
the standalone `d1-remote-restore-evidence` restore job, with
`source_backup_migration_ledger_stale` (runs 34839539920, 34840895993,
34844447445, 34844527222 and every `d1-restore-proof-auto-refresh` run).

Root cause: a mid-ledger hole in the append-only production D1 ledger.
Production applied `0098_widen_source_target_connector_gdelt.sql` while
`0098_widen_source_target_connector_bluesky.sql` was still repo-only
(run 34705843153, #3315), then appended the sorted `0098_bluesky`→`0102`
tail while `0098_competitor_suggestion_dismissal.sql` (#3175) and
`0103_widen_source_target_connector_youtube.sql` (#3203) had not yet landed
on main. The live ledger (117 names, verified from run 34844527222's
`source_backup_migration_ledger_names` dump) ends at
`0102_widen_source_target_connector_podcast.sql` with the two names absent.
No declared order exception covered that arrangement, so
`planSourceBackupLedgerReconciliation` rejected the ledger instead of
planning the catch-up, and every restore-evidence run — the standalone
workflow, the auto-refresh, and the deploy's own `generate_restore_evidence`
job — failed closed. Deploys could not ship the site-scan fix.

Fix (this PR): extend `PRODUCTION_MIGRATION_LEDGER_ORDER_EXCEPTIONS` in
`scripts/d1-migration-sync-check.lib.mjs` — the 0098 gdelt/bluesky pair group
becomes the full nine-name group declaring the live order
(`0098_email_delivery_canary`, `0098_gdelt`, `0098_bluesky`, `0099`→`0102`,
then `0098_competitor_suggestion_dismissal`, `0103_youtube` at the tail).
Under it the live ledger is a clean prefix of exactly one allowed ledger and
the planner emits `apply_forward_suffix` for the two pending names; the
restore drill then applies them via the sanctioned
`wrangler d1 migrations apply 0509 --remote` path (scratch dry-run +
per-table row-count invariant + Time Travel bookmark first), the re-backed
ledger matches, and the deploy gate clears. Simulation against the real
production ledger dump (run 34844527222, replayed through
`planSourceBackupLedgerReconciliation` locally): plan =
`apply_forward_suffix [0098_competitor_suggestion_dismissal,
0103_widen_source_target_connector_youtube]`; post-apply
`assertMigrationLedgerMatchesRepository` = true.

`tests/d1-remote-restore-evidence.test.ts` updated: the 0098 catch-up test
now models the live ledger (ends `0102`, two pending names) and asserts the
planned suffix is exactly the two missing migrations; a ledger carrying
`0103` ahead of the still-pending `0098` dismissal matches no declared order
and stays `reject` — fail-closed, no invented interleave.

Runs:

```
npx vitest run --configLoader runner --project node \
  tests/d1-remote-restore-evidence.test.ts tests/d1-migration-sync-check.test.ts
  Test Files 2 passed (2) / Tests 45 passed (45)
```

Remaining accept gate: a green `deploy-production` run, a `0 */3 * * *`
monitoring tick writing `website_site_scan` rows, then the next
`meta-discovery-canary` scheduled run (`23 */3 * * *`).
