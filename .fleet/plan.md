# Phase plan — fix(seo): sitemap lists /timeline/:domain pages that serve a 410

Issue: Nishfleet/0509#1928. Manager mode (`difficulty: heavy`).

## Goal
Make the sitemap timeline lister mirror `loadOfferTimeline`'s actual
renderable set: a domain is listed iff the route would render the dated
ledger (200), not when it would 410. Currently
`loadIndexableTimelineEntries` reads the global newest-N rows and dedupes by
domain, which lets domains through whose only passing rows are outside the
screenshot's read window (and so the route's 200-entry per-domain LIMIT
returns 0 entries).

## Acceptance-driven phases

- [x] phase 1: rewrite `loadIndexableTimelineEntries` + `indexableTimelineEntriesFromRows` so a domain is listed iff it has at least one row that survives the loader's own filter inside the loader's per-domain `TIMELINE_SNAPSHOT_LIMIT` window. Implementation: read all snapshot rows in one bounded query (`canonical_url LIKE 'https://%' OR canonical_url LIKE 'http://%'`, ordered `captured_at ASC, id ASC` to mirror the loader's `ASC LIMIT 200`), bound at `SITEMAP_TIMELINE_PATH_LIMIT * TIMELINE_SNAPSHOT_LIMIT = 100_000`. In JS: group by derived registrable domain (same `timelineDomainFromSnapshotRow` extraction), for each domain take the first `TIMELINE_SNAPSHOT_LIMIT` rows (the loader's window), apply the existing proof gate + ad-destination gate + `canonicalUrlBelongsToDomain`. List domains with >=1 passing row. Document the D1 read cost change in the PR body per accept #6. Keep `TIMELINE_SNAPSHOT_LIMIT = 200`, the proof gate (#1284), and the ad-destination gate (#1729) untouched.
- [x] phase 2: unit assertions in `tests/sitemap.server.test.ts` — `indexableTimelineEntriesFromRows` (a) excludes a domain whose only passing row falls outside the loader's per-domain `TIMELINE_SNAPSHOT_LIMIT` window, (b) still includes a domain whose oldest-200 window has at least one passing row. Plus update the existing "bounds to SITEMAP_TIMELINE_PATH_LIMIT entries" assertion to cover the new bound shape (per-domain cap inside a larger global read). (77 tests pass on the rebase.)
- [x] phase 3: integration test under `tests/integration/timeline-sitemap-parity.integration.test.ts` that applies real migrations, seeds more than `TIMELINE_SNAPSHOT_LIMIT` rows per domain and asserts every domain emitted by `loadIndexableTimelineEntries` also returns non-empty `entries` from `loadOfferTimeline` for that same domain. A mocked-binding unit test does not count (accept #4). Also asserts a domain whose oldest-200 window is all proof-less is excluded from the sitemap entries even when newer passing rows exist beyond the window. (3 tests pass against real D1.)
- [x] phase 4: verification — `tests/sitemap.server.test.ts` (77), `tests/integration/timeline-sitemap-parity.integration.test.ts` (3), and the existing `timeline-renders.integration.test.ts` (410 retirement guard, accept #2) green; rebased onto current origin/main; `bin/fleet-*` PR-body checks pass; PR opened with Verification + run-proof + research + help-first receipts; auto-merge armed.

## Files to Modify
- `app/lib/sitemap.server.ts` — rewrite `indexableTimelineEntriesFromRows` (per-domain grouping + first-N-per-domain window) and `loadIndexableTimelineEntries` (single bounded read of all candidate rows, ordered ASC to match loader).
- `tests/sitemap.server.test.ts` — add unit assertions for the per-domain window qualification; update the existing bound assertion.

## New Files
- `tests/integration/timeline-sitemap-parity.integration.test.ts` — real-D1 parity invariant test.

## Risks
- The new read is `SITEMAP_TIMELINE_PATH_LIMIT * TIMELINE_SNAPSHOT_LIMIT = 100_000` rows max — large but bounded; document in PR body (accept #6). D1's default row read limit is 100k so this fits exactly; will note any cost delta vs. the previous top-500 read.
- `indexableTimelineEntriesFromRows` is exported and unit-tested; keep its signature stable.
- The URL-shape filter in `loadOfferTimeline` is per-domain and more restrictive than `(canonical_url LIKE 'https://%' OR canonical_url LIKE 'http://%')`. The broad filter is a SUPERSET of any loader filter; the JS-side `canonicalUrlBelongsToDomain` narrows it back to the loader's effective set.
- Do NOT change `TIMELINE_SNAPSHOT_LIMIT`, the proof gate, or the ad-destination gate — those are the existing organs whose bug was a loader/lister mismatch, not a defect in those organs (accept #3).
- Gate-owned paths (`.github/**`, `migrations/**`, `plan.server.ts`, `competitor-site-monitor`, `auto-competitor-seed`) MUST NOT be touched.
- The integration test applies real migrations and seeds many rows — keep its seed count bounded (e.g., 3 domains × 250 rows) so the suite stays under D1's row read cap.