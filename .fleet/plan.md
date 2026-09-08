# Plan — Sitemap-timeline cohort backfill for calendly.com / adspyder.io (issue #1958)

Manager mode (heavy). The nightly offer-timeline backfill rail covers only the demo brands plus the sneaker-resale cohort (PR #1956); calendly.com and adspyder.io sit in no cohort, so their indexed /timeline/:domain pages freeze at the seed capture. Extend the SAME scheduledTask daily block (no new cron, no new service, no migration) with a bounded cohort of sitemap-listed timeline domains carrying complete proof AND verified ad coverage, reusing captureLandingPageSnapshot honest-capture semantics; the sneaker-resale rail is the shape precedent.

## Phases

- [x] phase 1: pure cohort helper + read-only D1 adapter mirroring deriveSneakerResaleCohort / getSneakerResaleTierByDomain; unit-testable without a DB; a domain whose tier lookup says no verified coverage keeps its honest existing timeline and stays off the cohort.
- [x] phase 2: nightly timeline-cohort backfill module reusing captureLandingPageSnapshot with honest-capture semantics (requireScreenshot: true, per-brand failure isolation, deterministic row id, INSERT OR IGNORE); rows written only with real screenshot + page text.
- [x] phase 3: extend the EXISTING daily backfill rail in workers/app.ts (same scheduledTask block — NO new cron, NO new service, NO migration) with a bounded sitemap-timeline cohort: calendly.com and adspyder.io.
- [x] phase 4: real-D1 integration test applying the capture path against a calendly-like fixture — fresh row with a real screenshot written; no-coverage fixture writes nothing; per-day idempotency; three-night dated-ledger accumulation.
- [x] phase 5: full verification (all suites green, tsc clean, sgscan/crgate/repo tests), PR with Verification/run-proof receipts + reviewer round + arm.

## Manager decisions (full rationale in the PR body)

1. No `expires_at > now` gate on the tier read — calendly/adspyder have no scheduled writer, so a freshness gate would empty the cohort nightly; age surfaces via `cacheStatus` and `stale=N`.
2. Sibling, not chained after the publisher — all publisher-written seed domains are in the static exclusion set, so no same-tick coupling exists.

## Files

- `app/lib/sitemap-timeline-cohort.ts` — pure cohort derivation + path extractors + canonicalizer.
- `app/lib/sitemap-timeline-cohort.server.ts` — read-only D1 adapter: candidates (wraps loadIndexableTimelineEntries), tier read (no expiry gate), static exclusion set.
- `app/lib/sitemap-timeline-backfill.server.ts` — nightly capture module (row id, INSERT OR IGNORE, per-brand isolation, summarize, SITEMAP_TIMELINE_COHORT_CAP).
- `workers/app.ts` — sibling `ctx.waitUntil` in the existing daily block; failure name `sitemap_timeline_backfill`; no cron changes.
- Tests: `tests/sitemap-timeline-cohort.test.ts`, `tests/sitemap-timeline-backfill.server.test.ts`, `tests/worker-scheduled-handler.test.ts`, `tests/integration/sitemap-timeline-backfill.integration.test.ts`.

## Out of scope

- No migrations, wrangler cron config, workflows, verifier/deploy/GitHub paths.
- Read/reused, NOT modified: timeline route, sitemap module, sneaker/demo backfill modules, data/seed-lists.

## Reviewer rounds (seat cursor/cursor-grok-4.6-high; full buckets in the PR body)

- Phases 1-4: Act on: none each round. Carried Consider items: retention-decay premise, real-D1 tier-adapter fixture gap, missing-table degrade marker, CAP-vs-subset hygiene.
- Phase 5: Act on: none. Suggestion fixed (literal cron constants in the do-not-run case). Both manager decisions upheld.