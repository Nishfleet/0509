# Lane evidence: claim/issue-2771

Issue: Nishfleet/0509#2771 — "site-scan manifest needs a real
crawl-discovered count so `crawl reached N` can return to the coverage
label" (split out of #2440).

## What shipped (2026-09-20)

Option **(b)** from the issue — nullable `crawl_discovered_count` column on
`website_site_scan`, expand phase only. Option (a) (a distinct
`discovery_source` vocabulary value for crawl pages) was rejected: the
column carries a CHECK constraint on both `website_site_scan_page` and
`website_page_observation`, so widening the vocabulary means two
rename/copy/drop table rebuilds — a shape the fleet D1 rule bans in the same
PR as a code change, and it still could not separate pre-existing rows.

- `migrations/0107_website_site_scan_crawl_count.sql` —
  `ALTER TABLE website_site_scan ADD COLUMN crawl_discovered_count INTEGER
  CHECK (crawl_discovered_count IS NULL OR crawl_discovered_count >= 0)`.
  Nullable, no DEFAULT — NULL means "no crawl count recorded", never zero.
  No dual-write in this PR; the write lands with the dual-write phase.
- `app/lib/types.ts` — `WebsiteSiteScanRecord.crawlDiscoveredCount:
  number | null`.
- `app/lib/data/watchlist-site-pages.server.ts` — row interface + mapper.
  `beginWebsiteSiteScan`'s INSERT and `finalizeWebsiteSiteScan`'s UPDATE are
  deliberately untouched (they are the dual-write phase's diff).
- `app/lib/competitor-site-monitor.server.ts` —
  `WebsiteCoverageLabelInput.scan.crawlDiscoveredCount` and the
  `crawl reached N` clause, rendered only when the persisted count is
  non-null (0 included — an honestly recorded empty crawl).
- `app/lib/watchlist-route-loader.server.ts` — threads
  `latest.scan.crawlDiscoveredCount` into the label input.

## Verification

- `npx vitest run --configLoader runner --project node
  tests/competitor-site-monitor.server.test.ts
  tests/watchlist-site-pages.server.test.ts tests/watchlists.route.test.ts
  tests/competitor-site-monitoring-migration.test.ts
  tests/migration-foreign-keys-off.test.ts` — 5 files / 113 tests, all pass.
- `npx vitest run --project workers
  tests/integration/website-scan-baseline.integration.test.ts` — 11 tests
  pass against real D1 (3 new: NULL default for pre-dual-write inserts,
  written count round-trips through `getLatestWebsiteSiteScanForWatchlist`,
  CHECK rejects -1).
- `npx vitest run --configLoader runner --project node --changed
  origin/main` — 423 files / 5017 tests, all pass.
- `semgrep --config p/default --baseline-commit $(git merge-base HEAD
  origin/main) --quiet --metrics=off` — no findings.
