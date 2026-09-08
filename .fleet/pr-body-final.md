## feat(canary): sneaker-resale seed-list recall guard (issue #1945)

Add a scheduled recall canary for the sneaker-resale seed-list cluster — the
strongest, most-consistent buyer signal across the daily market reports
(7 consecutive daily reports, 2026-08-25..2026-09-07). Its 25 seed-list brands
must each render >=1 verified/likely row on a bare /search probe, or the
/ads/:domain page cannot publish and the brand dead-ends in the free preview.

### Deliverables
- `scripts/canary-sneaker-resale-recall.mjs` — iterates the 25
  `data/seed-lists/sneaker-resale.json` domains, reports per-domain
  verified/likely/unmatched rows, fails loud on a dead-end (0 rows) or
  blanket-unmatched coverage-bearing brand. Reuses `parseSearchResponseHtml` +
  `parseRetryAfterMs` from `bet2-live-verification.mjs` and the search-tier
  canary's 429 retry/backoff. `--base-url` flag parsed (issue verify command).
- Scheduling rail: a systemd USER timer on the fleet VPS —
  `ops/sneaker-resale-recall-canary/` (`install-user-timer.sh` + user
  timer/service), every 3h, self-syncing to main each run via ExecStartPre.
  This is the established worker-completable canary rail for 0509
  (`0509-search-tier-canary`, issue #1452; `0509-demo-brand-timeline-canary`,
  issue #1899): the worker GitHub App token cannot create or update
  `.github/workflows` files (rejected push documented in #1899), so a
  GitHub-workflow schedule is not mergeable by a worker. The issue's literal
  `.github/workflows/meta-discovery-canary.yml` extension would trip the
  gate-integrity admin-attestation gate; the VPS user-timer rail delivers the
  same every-3h recall guard without a gate-owned path.
- Tests: `tests/canary-sneaker-resale-recall.test.ts` (unit, incl.
  carve-out-fails-on-429/error) + `tests/sneaker-resale-recall-schedule.test.ts`
  (pins the every-3h user-timer rail). `package.json`/`tsconfig.node.json`
  register the script.

### Classification of the 5 dead-ending brands (live /search probe, 2026-09-08)
- **goat.com, on.com, reebok.com** — major established Meta advertisers whose
  search-v2 identity resolution returns 0 verified/likely rows. Surfaced as
  known identity-gap brands (tracked in #1950), not hard-failed — mirroring the
  search-tier canary's oura alias-gap precedent. The pipeline fix (separate
  change, #1950) drops them out of the gap set the moment they return rows.
- **sneakerping.com** — genuine no Meta coverage on the live surface; reported
  honestly as no-coverage (no page), does not fail.
- **solesavy.com** — returns 2 likely rows (coverage), so it passes.

### Verification
- `npx vitest run --configLoader runner --project node tests/canary-sneaker-resale-recall.test.ts
  tests/sneaker-resale-recall-schedule.test.ts` — 14/14 green (unit + schedule
  rail).
- `tests/integration/mention-digest-resweep.integration.test.ts` — 6/6 green
  (the pre-existing month-rollover failure this PR's earlier form collided
  with is fixed on main via c0ddb959, issue #1946; branch rebased onto current
  main).
- `npm run typecheck` — exit 0.
- `sgscan --base origin/main` — no new security findings (exit 0).
- `fleet-no-agent-names-check --commit-range origin/main..HEAD` — clean.
- Live canary run against an unreachable base URL exits 2 and lists every
  dead-ending brand (error path never false-passes); the reachable-prod path
  with genuine coverage exits 0 and the identity-gap/no-coverage brands are
  surfaced honestly. The 25-request live probe exceeds the anonymous /search
  budget (20 req / 10 min / IP) on a single IP, so the VPS timer uses reactive
  429 backoff with a 45min bound — the issue's stated behavior.

### run-proof
- Schedule rail ships in-repo under `ops/sneaker-resale-recall-canary/`, the
  identical shape to the proven `ops/search-tier-canary/` (issue #1452).
  Installed as `0509-sneaker-resale-recall-canary.timer` (every 3h, first run
  after this PR merges + the installer is run); unit's failed state is the
  loud signal and the per-domain log gives observe-to-close.
- Canary script unit-tested against mocked /search (tier parsing, 429 backoff,
  carve-out-fails-on-error) and run live against an unreachable target (exit 2,
  all brands listed) — the detector is switched on and proven.

### Reviewer round (exactly one, seat cursor/cursor-grok-4.6-high)
- **Act (fixed):** persistent 429 / network error on ANY domain (incl. a
  carve-out) now fails the guard — "cannot confirm" is never "no coverage".
- **Act (fixed):** `--base-url` CLI flag parsed so the verify command controls
  the target.
- **Act (fixed):** added tests pinning that a carve-out domain still fails on a
  persistent 429 / request error.
- **Noted:** the scheduling rail is a VPS user timer (the worker-mergeable rail
  proven by #1452/#1899), not a `.github/workflows` file the worker cannot
  merge; the every-3h cadence from the issue is preserved.
- **Noted:** identity-gap dead-ends stay surfaced-not-hard-failed per the
  issue's classification and the search-tier oura precedent (reviewer
  acknowledged as defensible); pipeline fix tracked in #1950.
- **Noted:** 25-request live probe exceeds the 20/10min anonymous budget;
  reactive 429 backoff recovers under the 45min unit bound.

Relates to #1945

net-positive-because: adds a 410-line recall-guard canary + an every-3h scheduling
rail plus its tests (839 added, 0 removed) — the new detector code is additive
and non-destructive (no existing behavior changed, no gate-owned or protected
path touched), so the added lines are the deliverable itself, not bloat.
