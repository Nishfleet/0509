# Lane evidence — claim/issue-3356 (issue #3356, unit pi-issue-0509-3356)

## What this lane is

#3356 caps the /ads programmatic corpus: 4 seed lists = 121 domains, production
sitemap = 127 /ads URLs. The #1549 nightly publisher (mechanism, BET-2-gated,
429-hardened, 15-min wall budget, persisted-cursor resume) is fine; its INPUT
is the ceiling. This lane widens the input only.

## Inherited (salvage, by the book)

Five prior runs of this same unit banked into this worktree (issue comments
13:36–17:33 + 19:46Z). Inherited, verified, and kept:

- `data/seed-lists/fashion-ecommerce.json` — 125 domains, #1549 schema, real
  brand display names, no placeholders (committed af96e89d0/523075c13 line).
- `data/seed-lists/home-garden.json` — 90 domains, same schema (same commits).
- `app/lib/ads-domain-publisher.server.ts` — +2 imports, +2 SEED_LISTS entries
  (appended AFTER existing cohorts — cursor-safe, issue #2361), comment truth.
  No mechanism, no pacing, no orchestrator touched (accept 1, 3).
- `tests/ads-domain-publisher.test.ts` — +53 lines: registry order, whole-registry
  validation, exactly 125 / exactly 90, no placeholder brands, seeded-domain marking.
- `.fleet/pf-3356-*.log` + `.fleet/preflight-3356-tranche-logs.txt` — the preflight
  evidence: sneaker-resale 26/26 PREFLIGHT-EXIT=0 (the issue's hard gate, PROVEN at
  19:13Z); fashion-ecommerce PASS 104/125 (gate=100); home-garden 20/90 done when
  the 150-min deadline killed the run (4804 class: deadline 150 vs ~4h45m paced need).
- `.fleet/pf-3356-continuation.sh` + `.fleet/preflight-3356-tranche-packet.md` — the
  measured-continuation contract (senior auditor, committed 6dffa493a): deadline 300
  never 150, deliverable written INCREMENTALLY after each leg, fashion BANKED (do not
  re-run), sneaker re-run with retry-once on transient 500, home-garden the only
  missing leg.

## This run added (final state at head fa7f1b14d)

1. Merged origin/main twice on this branch (79 commits incl. #3278 429-limiter,
   then 13 more at fa7f1b14d) — clean, no conflicts; the diff touches no pacing
   line (accept 3: limiter untouched).
2. Dispatched the continuation contract verbatim:
   `pi-systemd-run --unit pi-issue-0509-3356-preflight-tranche-c2 --deadline 300
   --deliverable .fleet/preflight-3356-tranche-logs.txt -- bash
   .fleet/pf-3356-continuation.sh`. The c2 unit completed ALL THREE legs —
   sneaker 26/26 exit 0, fashion 104/125 PASS, home-garden 70/90 PASS (the
   three `TRANCHE-LEG-COMPLETE` lines in `.fleet/preflight-3356-tranche-logs.txt`,
   resume-unit record at the tail). Known degradation, tracked upstream:
   `HC_URL_DETACHED unset` → the detached START/complete healthchecks ping
   skipped (journal-only); dead-man + salvage still enforced deliverable-at-stop
   (fleet-ops#6359).
3. Re-proved the issue's hard gate at THIS head:
   `npm run seed:publisher -- --list=sneaker-resale --dry-run --min-publish=26`
   → 26/26 publishable, exit 0 (2026-09-14T00:14Z,
   `.fleet/pf-3356-sneaker-finalhead2.log`). Two earlier final-head attempts hit
   transient search-backend HTTP 500s (logged, not hidden:
   `.fleet/pf-3356-sneaker-finalhead{,-retry}.log`); the clean re-run is the
   proof, consistent with the 19:13Z banked run at the pre-merge head.
4. Affected node suite at final head: 30 files / 503 tests, all pass, exit 0
   (`npx vitest run --configLoader runner --project node --changed origin/main`).
   No coverage, no typecheck, no second suite (memory budget, fleet-ops#4891).
5. `node scripts/check-ads-timeline-links.mjs` (#1931 sweep) → OK, 286 indexable
   /ads pages link their /timeline, exit 0.
6. `sgscan --base origin/main` → no new security findings, exit 0.
   PR-body gates: `fleet-no-agent-names-check` OK, `prove-one-run-check` OK,
   `fleet-exec-review-canary` OK.

## Resume run added (head = branch tip after the 4-commit origin/main merge)

1. Fixed a garbled doc-comment in `ads-domain-publisher.server.ts` — the prior
   edit duplicated the sentence start; the comment now reads correctly.
2. Merged origin/main again (4 commits: ads.$domain route + legacy-slug tests,
   none touching the publisher paths).
3. Re-proved the issue's hard gate at THIS head:
   `npm run seed:publisher -- --list=sneaker-resale --dry-run --min-publish=26`
   → 26/26 publishable, summary PASS, `PREFLIGHT-EXIT=0`
   (2026-09-14T09:47Z, `.fleet/pf-3356-sneaker-finalhead6.log`). The prior
   finalhead5 attempt was killed mid-run at 20/26 by the unit restart — its
   truncated log stays committed, not hidden.
4. `node scripts/check-ads-timeline-links.mjs` → OK, 286 indexable /ads pages
   link their /timeline, exit 0 (2026-09-14T09:45Z).
5. Affected node suite at this head: 31 files / 488 tests, all pass, exit 0
   (`npx vitest run --configLoader runner --project node --changed origin/main`).
   No coverage, no typecheck (CI owns both, fleet-ops#4891).
6. `.pr-body-3356.md` moved to `.fleet/pr-body-3356.md` — root-level pr-body
   files were already cleaned off main once (d3266323a); `.fleet/pr-body-*` is
   the landed convention.

## Honest limits

- The issue's termination (production sitemap >= 300 /ads) is the #1549 NIGHTLY's
  arithmetic, not a same-PR fact: 215 added domains at the documented 15–30
  domains/night = 6–12 nights AFTER this lands. No acceleration promised, none
  shipped (accept 1: no second orchestrator).
- Production telemetry (`ads_domain_published`/`_skipped`/`_failed`) is the
  floor-honesty record (accept 2); the local preflight logs are corroboration.
  fashion's 7 failed / 14 skip stay IN the list — the nightly retries them and
  records the outcome; nothing was hidden.
- No D1 migration (accept 4: runtime publish path only, zero migrations touched).
- No gate-owned path touched (accept 5): no `.github/**`, no test removed or
  skipped; the lane adds tests only.

Diff vs origin/main: 2 new seed lists (215 domains), +2 registry entries +comment
in the existing publisher module, +1 test describe (5 assertions-groups), issue-
unique `.fleet/` evidence, this lane record. 14 tracked files, +~1.6k/−6.
