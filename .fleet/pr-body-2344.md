refactor(d1): move demo/sitemap brand seeds out of the migration chain

## Acceptance / scope
Issue #2344 (reccos: delete — stop putting data backfills in the schema migration
chain). Per the binding judge edit:
- Migrations `0079_backfill_demo_brand_offer_timelines.sql` and
  `0081_backfill_sitemap_brand_offer_timelines.sql` stay in the chain
  byte-for-byte (production already applied them).
- New `scripts/seed-demo-brands.mjs` runbook holds their seed rows (5 demo
  brands + 25 sitemap brands) and delivers them on demand.
- `tests/integration/apply-migrations.ts` now skips 0079 and 0081 by name, so
  every integration-test database is schema-only: demo seeds exist only where
  the runbook actually runs.

The two integration suites that used to assert migration-seeded rows
(`demo-brand-timeline-backfill`, `sitemap-brand-timeline-backfill`) were
updated to drive the replacement runbook's exact INSERT onto the schema-only
local D1 and assert the same honest-evidence contract the migrations
guaranteed, so coverage is preserved (not skipped/weakened). 0079/0081 fully
ran on the production ledger; integration test DBs no longer inherit demo
rows.

## Verification
- Full `workers` (real workerd + real local D1) vitest project:
  `Test Files 52 passed (52)`, `Tests 257 passed (257)` against the
  schema-ONLY migration set.
- Relocated-seed suites (13 tests) drive
  `scripts/seed-demo-brands.mjs`'s exact `INSERT OR IGNORE` onto local D1 and
  assert: `artifact_key` NULL, `metadata_json` `backfill:true`, correct
  `capture_method` (`demo_backfill` / `sitemap_brand_seed`), proof-gate
  filtering out of the public timeline, and idempotent re-runs.
- `node` project via `--changed origin/main`: no affected node tests.
- Runbook exercised locally: `node scripts/seed-demo-brands.mjs --help` and
  `--demo-only --out-file /tmp/seed-demo-0079.sql` (5 demo rows emitted).

run-proof: scripts/seed-demo-brands.mjs (--help / --out-file); test DB
  built by tests/integration/apply-migrations.ts (workers vitest project, 52/52
  files); tests/integration/{demo-brand-timeline-backfill,sitemap-brand-timeline-backfill}.integration.test.ts

## Test plan
- `npm test` = node + workers vitest projects (CI owns coverage/typecheck).

net-positive-because: removes demo seed rows from fresh/schema-only D1
  databases (including every integration-test DB) so the accept that demo seeds
  exist only where the runbook runs is enforced; migrations are untouched.

research: checked the existing `scripts/` runbook conventions
  (d1-cleanup-0060-evidence.mjs, cta-field-funnel-backfill.mjs) before building
  `scripts/seed-demo-brands.mjs`; adopted the wrangler `d1 execute`
  spawnSync pattern already proven in-repo.
help-first: `scripts/seed-demo-brands.mjs --help` documents the CLI surface;
  no existing script already owns demo-brand seeding once 0079/0081 are
  skipped from fresh DBs.

Closes #2344