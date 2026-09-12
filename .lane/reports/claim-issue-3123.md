# Lane evidence — claim/issue-3123 (unit pi-issue-0509-3123, issue #3123)

Manager-mode run. Plan: `.fleet/plan-3123.md` (issue-unique, per the parallel-lane convention).

## What shipped

- Phase 1 (prior run, salvaged + rebased onto origin/main): two curated seed cohorts
  `data/seed-lists/beauty-personal-care.json` (29 domains) and
  `data/seed-lists/saas-software.json` (36 domains), both registered in `SEED_LISTS`
  (app/lib/ads-domain-publisher.server.ts) with registry pins, real brand display
  names (phase-1 reviewer fixes: credobeauty.com placeholder→"Credo Beauty", festive
  cross-list dupes dropped), festive byte-stable.
- Phase 2a/2b: sequential `seed:publisher --dry-run --min-publish=15` gates for both
  new lists, run detached via `pi-systemd-run` unit `pi-issue-0509-3123-probes`
  (deliverable `.fleet/probes-2a2b-done.log`; evidence `.fleet/probe-beauty-personal-care.log`,
  `.fleet/probe-saas-software.log`). The prior session's beauty probe was killed
  mid-run at 26/29 domains (42-min hang-kill); the re-run is a full completed pass.
- Phase 3: `tests/ads-domain-publisher.test.ts` — "publish floor at the list-input
  boundary": through `runAdsDomainPublisher` on the real registered list, a
  ready-and-proven-empty (0 verified + 0 likely) domain comes out verdict `skip`
  (reason `No verified/likely coverage (0 verified, 0 likely` + `empty reason:`),
  contributes nothing to published, while its ≥1-verified neighbour publishes.
  Targeted run: 49/49 passed (new test passes 1/1 via `-t`).
- Phase 4: sitemap observation — `https://0509.io/sitemap.xml` carried 115 `/ads/`
  URLs at 2026-09-12T12:11:54+05:30 (baseline 114 at session start); spot-checks
  elfcosmetics.com / sephora.com / ulta.com / glossier.com present. The /ads/
  surface tracks coverage-primed domains, so probed cohorts surface pre-merge;
  the saas cohort publishes via the existing nightly after deploy.

## Reviewer adjudication

Phase-1 reviewer round (prior session): Act-on fixed (cd44438ee → rebased as b8b938ea8);
Consider (mamaearth.in "More brands" hub degradation) and Noted (registry order, fixture
absence, net-up assertions, no gate-owned paths) recorded in `.fleet/plan-3123.md`.

Final-diff reviewer round: recorded in the PR body (single round, no loops).

## Memory budget

No coverage, no typecheck, no tsc. Targeted `npx vitest run --configLoader runner
--project node tests/ads-domain-publisher.test.ts` only (2.3 s, one file).
