# Lane evidence — claim/issue-3179 (issue #3179, mentions epic slice 3)

Parent: #3171. Dependency: #3178 (slice 2a, mentions table) — CLOSED, its
migrations are on `main`; this diff adds none.

## What this lane shipped

Extends the existing renderers only (no new email path):

- `app/routes/timeline.$domain.tsx` — the public /timeline/:domain list now
  interleaves stored mentions of the domain (from any workspace's trackers)
  with the existing ads rows; each mention carries its source label and links
  the source article. Dedupe by mention identity.
- `app/lib/mention-digest.server.ts` + `app/lib/delivery.server.ts` — change
  alerts and the presence digest include new mention lines, each with its
  source and a real anchor to the canonical URL (the trailing URL text became
  a link; no new email path).
- `app/lib/presence-entity-brief.server.ts` — entity briefs summarise mentions
  for the tracked entity alongside website changes; copy rounded through the
  unslop pass ("website changes and public mentions, each with its source").
- `app/lib/plan-entitlements.ts` + `app/lib/presence-entitlements.ts` — Free
  accounts track their SELF brand (1 tracked entity) with first check + first
  brief; no recurring tracking on Free (Free-is-barebones decision).
- Suppression / rate-limit paths: untouched (verified: no diff in any
  suppression- or rate-named file).

## Proof receipts (this lane, 2026-09-13)

- Node suite (affected-tests mode, coverage-free): `npx vitest run
  --configLoader runner --project node --changed origin/main` — 413 files /
  4969 tests, all passed (135s).
- Workers project, changed integration test: `npx vitest run --configLoader
  runner --project workers tests/integration/timeline-public-mentions.integration.test.ts`
  — 2 passed.
- Journey-1 release proof (diagnostic subset, retries=2): `node
  scripts/run-local-release-proof.mjs --diagnostic-subset --journeys=1` —
  3/3 viewports passed at 7d10c00fb (3.5m); at final head e6d8656ed the
  tablet first attempt timed out and passed on retry (manifest 78267cb6:
  strictIssues coverage_count:4:3, status:timedOut → reporter-strict verdict
  "failed" despite playwright "2 passed, 1 flaky"). Final zero-retry round:
  see the PR body `Verification:` / `run-proof:` receipt.
- sgscan: "No new security findings" (delta vs origin/HEAD 5c32a83c).

## Unit history (prior claim attempts of this issue)

Five earlier unit attempts died at deadline/StartLimitBurst; salvage banked
wip commits (fe265e18c, 48a084fd8, fe7c1cda2, af7e1eb59, 7d10c00fb) carrying
the implementation + proof rounds (Threads in the mention set, timeline
dedupe rename, fixture persona invariant 26→27, brief copy). This lane's work
was: re-entrancy pickup, two-suite green, journey-1 proof, gates, PR.

## Notes

- Fixture: cross-workspace Nike mention seeded in `e2e/fixtures/e2e-local.sql`
  (tracker persona count 26 → 27 in `scripts/e2e-local-fixture.mjs`); journey-1
  asserts the mention row, its source label, its title, and its source link.
- The diagnostic-subset manifest is journey-1-only by design; the canonical
  6-journey proof stays the launch-facing gate (release-scope.mjs).
