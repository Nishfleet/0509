# Lane report — claim/issue-952

BET 3 part 1: persist versioned landing-page snapshots.

## Change

`app/lib/monitoring.server.ts` — wire the existing `createLandingPageSnapshot`
D1 writer into both monitoring proof-capture paths so every fresh landing-page
capture appends a versioned `landing_page_snapshot` row.

- `evaluateSelectiveProofCandidates` (ad-observation captures)
- `evaluateDirectWebsiteProofCandidate` (direct competitor-website captures)

New helper `persistLandingPageSnapshotRow` wraps `createLandingPageSnapshot`
and never throws — a snapshot-row write failure is logged and swallowed so the
monitoring run still records its proof capture and events. The new snapshot id
is threaded into `proof_capture.capture_metadata_json` as `landingPageSnapshotId`
so each durable capture links back to its versioned snapshot row.

Replayed captures (a pre-existing succeeded proof capture with the run's
idempotency key) reuse the existing capture and do NOT append a duplicate
snapshot row — `freshSnapshot` is null on replay by design.

## Scope note: `website_watch_target`

The issue names `website_watch_target` as a second surface to populate. That
table does not exist in the current schema: migration `0012_website_watch_targets.sql`
is retired (listed in `RETIRED_PRODUCTION_MIGRATIONS` in
`scripts/d1-migration-sync-check.lib.mjs`) and is not referenced anywhere in
`app/`, `workers/`, `tests/`, or `migrations/`. The function it describes —
tracking each competitor landing page per watchlist — is already served by the
existing `proof_target` table, populated by `upsertProofTarget` on every
monitoring capture in both proof paths. No new table was created; creating a
duplicate tracking table is not the smallest durable change and would be a
schema decision for Nish.

## Verification

- `npm run typecheck` → clean (`cf-typegen && react-router typegen && tsc -b`).
- `npm test` → 5528 passed (464 files), including the new
  `tests/monitoring-landing-page-snapshot.test.ts` (2 tests: fresh capture
  persists a row with all fields; replay does not duplicate).
- `sgscan` on the diff → no new security findings.

## Rollback

Additive (new rows only). Revert stops new writes; existing rows are harmless.
No destructive migration.
