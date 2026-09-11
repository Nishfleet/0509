# Lane evidence — claim/issue-2436 (one-click accept fingerprint parity)

Issue: Nishfleet/0509#2436 — `handleAcceptSuggestedCompetitorAction`
fingerprinted candidates with `fingerprintSavedQuery` (no website component),
so the same suggested competitor could be duplicated across accept paths.
Source: Kimi K3 Max whole-codebase review F2, Fable-verified.

## Change

`app/lib/watchlist-route-actions.server.ts` — the accept action now builds
`targetFingerprint` through `watchlistFingerprint(normalizedQuery,
competitorWebsite)` like every other website-backed create path
(`competitor-import.ts` prepareImportRow, `search.tsx`, `setup-checklist-action`,
`customer-agent-actions/watchlists`). The dynamic `~/lib/normalize` import is
gone; all helpers were already top-imported.

## Deviation from the finding's `fix:` line — evidence

The finding prescribes `query: row.advertiser`. Verified empirically that this
still fails the issue's own accept oracle (one-click fingerprint must equal the
bulk path's for the same candidate): for advertiser "Rothy's" +
landingPageUrl "https://rothys.com" + country "United States":

- one-click with `query: row.advertiser`  → `fnv1a-5d3bd780`
- bulk path (`buildCompetitorImportPreview` on `Rothy's,https://rothys.com`)
                                          → `fnv1a-7c6fe854`
- one-click pre-fix (fingerprintSavedQuery) → `fnv1a-bca294c6`

Every website-backed path fingerprints the website's domain-derived
`searchTerm`, not the display name: the importer's `prepareImportRow` uses
`normalizedWebsite.searchTerm || name`, and `applyWebsiteSearchFallback`
substitutes `searchTerm` when the query field is empty. The fix therefore uses
`query: competitorWebsite.searchTerm ?? row.advertiser` — the finding's shape
verbatim except the query argument, which now matches the importer's own
derivation (`fnv1a-7c6fe854`, equal). Candidates with no `landingPageUrl`
produce the same fingerprint as before (`fingerprintSavedQuery` of the
advertiser query) — no behavior change on that path.

No migration of existing watchlist rows; dedup is forward-looking.

## Verification

- RED: new test in `tests/auto-competitor-suggested-panel.test.ts` captured
  the action's `targetFingerprint` and asserted equality with the bulk
  preview fingerprint → failed `expected 'fnv1a-bca294c6' to be
  'fnv1a-7c6fe854'` before the fix.
- GREEN after fix: `npx vitest run --project node
  tests/auto-competitor-suggested-panel.test.ts` → 20/20 pass.
- Affected-tests sweep: `npx vitest run --configLoader runner --project node
  --changed origin/main` → 14 files / 195 tests pass.
- `npm run typecheck` not run locally per repo AGENTS.md + fleet-ops#4891
  (worker memory budget) — CI's `codex-node-checks` owns it.
