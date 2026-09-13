# claim/issue-3373 — e2e:prod:public red on every Deploy production run

## Root cause (named)

#2965 (`47e56191a`, 2026-09-12 03:19 IST, "fix(seo): noindex parameterised /search, drop it from
sitemaps, 302 bare /search to /brands") changed the anonymous bare `/search` contract to
**302 → /brands** but updated zero e2e files (`git show 47e56191a --stat` — only `tests/`, no
`e2e/`). The prod-public smoke still asserted the retired contract — the "Find competitor ads"
heading on bare `/search` — so every deploy's `e2e:prod:public` proof failed. First red run:
34700701731 (2026-09-12T14:55Z, 4bf178e3); continuously red since (the issue's 05:37Z 09-13
window was a subset). The landing-capture warnings in the deploy log were noise from PASSING
tests; the failing assertions were always the smoke's.

Live-verified 2026-09-13: `GET https://0509.io/search` → 302, `location: /brands`; final page
`/brands` = 200, h1 "Browse all 127 tracked brands", 0 occurrences of "Find competitor ads".
The three CI-failing tests: prod-public.spec.ts:183, :251 (same "Find competitor ads" miss) and
:350 (buttons/links: bare `/search` now 302s to the hub, whose ~130 indexable brand links each
get a sequential reachability probe — the test's 60s budget fails on the median, 2.0m measured).

## Fix (fixture; every assertion grows)

- Both heading assertions now prove the post-#2965 funnel: 302 pinned (status + `Location:
  /brands`, same wording as #2965's own unit test) + the `/brands` hub heading via
  count-agnostic regex (`/Browse (all [\d,]+ )?tracked brands/` — survives brand-count drift,
  covers the zero-brand variant).
- Buttons/links test: 60s→120s, cause-carrying comment, same reasoning as the config's
  diagnostic-engine precedent ("once the slow path is systematically over budget, every
  attempt fails").

No assertion weakened; no test removed or skipped; no `[skippable]` added.

## Proof (this worktree @ 5c32a83c, the exact failing CI step, against live 0509.io)

- `PLAYWRIGHT_WORKERS=1 npx playwright test --config=playwright.config.ts --project=prod-public`
  → **14 passed / 3 skipped (production skips by design) / 0 failed, 3.0m**, including the three
  previously-failing tests: spec:183 ✓ 6.7s, spec:259 ✓ 2.0s, spec:360 ✓ 2.0m.
- Coupling: `tests/search-display.test.ts` (readFileSync's the spec) → 37/37 passed;
  `npx vitest run --configLoader runner --project node --changed origin/main` →
  "No test files found, exiting with code 0".
- `sgscan` → exit 0, "No new security findings". `crgate` → exit 0 (CodeRabbit not signed in on
  this box — named, per precedent; the senior reviewer round in the PR is the substantive review).
- #3262 rider (the issue's "check whether #3262's hunks still apply"):
  `gh pr diff 3262 | git apply --check -` → "error: patch failed:
  tests/launch-readiness-guard.route.test.ts:1979 … patch does not apply" — they no longer do;
  revival needs a rebase. (The #5715 armed-merge DIRTY tripwire stays queued on the
  fleet-ops findings side, as the issue notes.)

The acceptance's "green Deploy production run on current main" = the run this merge triggers:
the Deploy step itself has not failed once (the issue's evidence: SUCCESS Worker Version 100% of
traffic on every red run); the only red leg was e2e:prod:public, proven green above against the
same production target CI uses.
