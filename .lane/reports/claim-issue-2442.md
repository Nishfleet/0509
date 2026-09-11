# claim-issue-2442 — landing-page snapshot dedup race fix

Issue: Nishfleet/0509#2442 (review finding M8 — check-then-insert dedup with no
unique constraint on `landing_page_snapshot`).

## What shipped

- `migrations/0095_landing_page_snapshot_content_key.sql`: DELETEs pre-existing
  duplicates (newest `captured_at` survives, ties broken by `created_at`, `id`),
  adds `content_key` as a VIRTUAL generated column folding the nullable dedup
  signals (`cta_text`, `price_text`, `form_present`) to `''`/`-1`, then a UNIQUE
  index on it.
- `createLandingPageSnapshot` (`app/lib/data/ads.server.ts`): the
  SELECT-then-INSERT dedup is now `INSERT ... ON CONFLICT(content_key) DO
  NOTHING` + read-back of the surviving row by `content_key`; analysis fields
  are written only by the winning capture.
- Same-pattern sibling writers fixed in the same PR (do:3): the demo-brand,
  sitemap-timeline and sneaker-resale backfills wrote the table with
  `INSERT OR IGNORE`; left alone, the new index would let them report a
  `snapshotId` that never persisted. Each now names the conflict target and
  resolves the row that actually persisted.
- Tests: `tests/integration/landing-page-snapshot-persistence.integration.test.ts`
  gains a 20× concurrent-pair dedupe test and an 8-wide burst test (monitoring
  fan-out runs up to 8 in flight). Mocked-D1 suites updated for the new write
  shape.

## Judge-edit deviation (verified, documented in the migration)

The judge pinned `... GENERATED ALWAYS AS (...) STORED`. SQLite refuses a
STORED generated column via `ALTER TABLE ... ADD COLUMN` on any populated table
("cannot add a STORED column" — reproduced locally on sqlite 3.45.1), and prod
has rows. VIRTUAL is legal there, is indexable, and computes the same value, so
the unique index still makes the write atomic.

## Evidence

- RED (origin/main @ 947e478e7, unmigrated schema, new test only): first
  concurrent pair returned two different row ids; the 8-burst returned 8
  distinct ids (expected 1).
- GREEN (this branch): all 6 tests in the integration file pass, including
  20/20 concurrent pairs resolving to exactly one row.
- Node project: `npx vitest run --project node` on the touched files and
  `tests/ads*` — 19 files, 454 tests, all pass.
- `npm run typecheck` not run locally per fleet-ops#4891 (CI owns it).
