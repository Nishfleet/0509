# Meta lane honesty — demote Meta from hero copy + scheduled canary (lane 1 replay)

**Status: shipped on branch `0509-lane1-meta-canary-honesty-replay`, ready for PR.**

Branch: `0509-lane1-meta-canary-honesty-replay`
Base: `origin/main` at `6d4fcd2d` (current main tip)
Item ID: `26f343e192`

## Item

- [ ] Meta lane honesty — graduate Meta discovery reliability OR demote Meta
      from hero copy until the canary is green

## Verdict

The previous lane (commit `4169baeb` on `lane1/meta-canary-honesty`, 2026-08-14)
already produced this exact deliverable. The branch was never merged to main;
today's main still has the original Meta-heavy hero copy on lines 32 and 582 of
`app/routes/marketing.tsx`, and the scheduled canary workflow
(`.github/workflows/meta-discovery-canary.yml`) does not exist on main.

This lane replays the previous lane's work on a fresh branch from `origin/main`
so the item can move from "in-progress on a branch" to "open PR".

The concrete choice: **demote Meta from hero copy** (option 2 of the packet).
The canary is currently green only as a post-deploy check (Gate C passed
2026-08-14 on the live worker with `meta ads beta: ok`), but never on a
schedule. The hero's "Meta ads and landing pages" claim was not yet
canary-gated. Bonus: the scheduled canary workflow is the prospective
green-state gate that lets a future lane re-promote Meta. This is the exact
reasoning the previous lane recorded and is the only honest path until the
scheduled canary publishes a green state.

## What this PR delivers

5 files, +103/-6 lines.

- `app/routes/marketing.tsx` — hero deck and meta description now lead with
  landing-page change monitoring ("price, offer, and CTA changes") and name
  Meta Ad Library as a public source lower in the page. The comment block
  above `marketingDescription` explains the scheduled-canary gate honestly to
  future editors.
- `.github/workflows/meta-discovery-canary.yml` — new read-only scheduled
  Meta readiness canary every 3 hours (`cron: "23 */3 * * *"`), runs on
  `[self-hosted, linux, x64, vps-verify]`, hits
  `https://0509.io/api/launch-readiness` with `CANARY_BYPASS_TOKEN`, exports
  `metaAdsBeta.ok`, persists a JSON state artifact, and uploads it as a
  GitHub Actions artifact (`actions/upload-artifact@v7` pinned to the repo's
  standard SHA) for 7 days. Pattern matches `uptime-health.yml` and
  `d1-remote-restore-evidence.yml`.
- `tests/marketing-first-viewport-audience.test.ts` — the deck-intact check
  pins the new honest claim ("watches competitors' landing pages for price,
  offer, and CTA changes") instead of the old "Meta ads and landing pages".
- `tests/marketing-rebuild.test.ts` — same.
- `README.md` — the graduation note now explicitly records the
  scheduled-canary gate and the 2026-08-14 Gate C pass.

## Validation

Run on this branch in this worktree:

```
$ node node_modules/.bin/vitest run tests/marketing-rebuild.test.ts \
                               tests/marketing-first-viewport-audience.test.ts
 Test Files  2 passed (2)
      Tests  31 passed (31)
```

Full test sweep — no regressions:

```
$ node node_modules/.bin/vitest run
 Test Files  437 passed (437)
      Tests  5035 passed (5035)
   Duration  58.22s
```

The scheduled canary is not exercised in this branch (it depends on
production secrets and the live launch-readiness endpoint); it is wired
gate-closed and will fail loudly if `metaAdsBeta.ok` is not true at the
scheduled tick. The first scheduled run is the source of truth for whether
the lane can re-promote Meta in a future PR.

## Prior art on record

- `lane1/meta-canary-honesty` branch — commit `4169baeb` (the previous lane's
  deliverable, never merged). This PR is byte-for-byte the same surface
  patch, replayed on a fresh branch from the current main tip.
- `lane1/meta-library-menu-cta-already-resolved` — prior lane evidence that
  the Meta-library menu CTA is already honest on main.
- `lane1/brand-owns-ads-already-resolved` — prior lane evidence that the
  brand-page "is running"/"owns Meta ads" claims are already resolved by
  PRs #550 and #561 (separate item, different concern).

## Files

- `app/routes/marketing.tsx` — hero copy demotion.
- `.github/workflows/meta-discovery-canary.yml` — new scheduled canary.
- `tests/marketing-first-viewport-audience.test.ts` — pinned.
- `tests/marketing-rebuild.test.ts` — pinned.
- `README.md` — graduation note widened.
- `.lane/reports/0509-lane1-meta-canary-honesty-replay.md` — this evidence
  record.

## Rollback

The canary workflow is read-only and gate-closed (no `if: always()` on the
readiness step; it raises on non-green meta). If the canary misbehaves, the
dispatch CLI can disable the schedule by deleting the workflow file. The
hero copy revert is a single line in `app/routes/marketing.tsx` plus the
two test assertions.
