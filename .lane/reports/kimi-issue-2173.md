# kimi/issue-2173 — OWN THE RECORD: proof archive as product surface

## What shipped

One archive engine (`app/lib/archive.ts`, pure) behind three surfaces:

- Public `/timeline/:domain`: loader now calls `loadPublicDomainArchive`
  (`app/lib/archive.server.ts`), which reuses `loadOfferTimeline` wholesale
  (brand-page gate #1729, proof gate #1284, ad-destination exclusion all
  unchanged) and projects through `toPublicArchive` — public-ad facts only.
- Signed-in watchlist detail: new `Archive` tab
  (`app/lib/watchlist-detail-tabs.ts`, loader branch in
  `watchlist-route-loader.server.ts`, panel in
  `components/watchlists/competitor-detail.tsx`) fed by
  `loadWatchlistArchive` — everything the account captured: watch events in
  any status, the watchlist's own run-linked landing-page snapshots, its
  observed ads, its run cadence for gap honesty.
- Export + share: `archive` resource on the existing export route
  (CSV + JSON via `archiveExportResponse` in `app/lib/resource-export.ts`);
  `share-archive` action intent freezes a snapshot through the existing
  share-link machinery (`app/lib/archive-snapshot.ts` codec, rendered by
  `app/routes/share.$token.tsx`).

Compounding hooks (all deterministic, no LLM): first/last-seen + running-N-days
per ad (`buildAdTenure`), offer history series per landing page
(`buildOfferHistorySeries`), per-domain what-changed-this-month
(`summarizeArchiveMonth`). Honesty: every row carries captured-at +
capture-method; missing artifacts are labelled; `computeCaptureGaps` renders
capture gaps as gaps.

Shared renderer: `app/components/archive-ledger.tsx`; criticality bands reuse
`<Pill>` with token-only CSS (design-system ratchet stays clean).

## Verification

- `npm run typecheck` — green (cf-typegen && react-router typegen && tsc -b).
- `npm test` — green: node 640 files / 7573 tests, workers 43 files / 209 tests.
- New coverage: `tests/archive.test.ts` (engine + public/private split +
  snapshot codec round-trip), `tests/integration/archive.integration.test.ts`
  (query layer against real D1: proof gate intact, no private rows in the
  public archive, run-cadence gaps honest).
- Existing mocks extended, not weakened: `offer-timeline.route.test.ts` and
  `timeline-410-error-boundary.test.tsx` stub the four
  `offer-timeline.server` exports the archive layer now imports; the 410
  retire path (#1309) and degradation path assertions are unchanged.

## Notes

- `loadPublicDomainArchive` falls back to ledger capture timestamps if the
  capture-times read fails — gaps shown from what we can prove, never
  smoothed; a real D1 outage still fails `loadOfferTimeline` first and takes
  the existing degrade path.
- No new storage, no cadence or plan-limit changes, no new deps.
