# Lane evidence — claim/issue-3302 (Nishfleet/0509#3302)

## Task

Ship `/compare/sneakerping` — the 15th `/compare/*` surface — aimed at the
sneaker-resale demand cluster the 2026-09-12 market signal leads with
(SneakerPing's 59.5%-below-retail study is back, the Nike r/stocks thread still
growing). Acceptance: EN + $locale route pair on the compare.keeptabz pattern
(canonical→EN, #1562); claims only from SneakerPing's public pages, each cited,
switch framing ending in the free /search preview; sitemap + internal links from
the sneaker-resale cluster and /brands/sport-footwear; tests in the
compare-family conventions; #3147 adoption only if landed.

## Shipped

- `app/routes/compare.sneakerping.tsx` + `app/routes/$locale.compare.sneakerping.tsx`
  (canonical→EN, buyer-surface hreflang cluster, WebPage + exactly one FAQPage
  JSON-LD, #1863 data-source-url, CompareCitationsFooter).
- `app/data/compare/sneakerping-citations.json` — two cited sources, both
  verified live 2026-09-12: sneakerping.com (40+ store price-alert job, free
  5-pair tier) and sneakerping.com/sneaker-resale-market-report (3,538-release
  study: 59.5% below retail, median 10.6% under, figures as of 18 Aug 2026).
  Paid-tier pricing hedged; no uncited price numbers.
- Distribution: `SITEMAP_PATHS` + `PUBLIC_MARKDOWN_PATHS` + llms.txt entry
  (`app/lib/seo.ts`, `app/lib/public-markdown.ts`), the #3167 footer compare
  rail `vs SneakerPing` (`app/components/marketing-footer.tsx` — the rail
  renders on every /sneaker-resale/* page incl. the hub via
  SneakerResaleLanding, and on /brands/* incl. /brands/sport-footwear via
  brands.$category.tsx), `COMPARE_PRODUCT_NAMES` row so the og:image resolves
  (`app/lib/social-cards.server.ts`, the #3237 404 lesson), routes.ts
  registration (EN + $locale).
- Tests: `tests/compare-sneakerping.route.test.ts` (5 cases: route-module
  posture, /search-preview CTA, sitemap <loc> + llms.txt, #1562 canonical
  pair, internal links + og:image resolution) plus the registry updates the
  new paths require (`tests/customer-claim-surface-registry.test.ts`,
  `tests/sneaker-resale.route.test.ts` swing-scoped #2856 assertion).

## Receipts (2026-09-13, this worktree @ claim/issue-3302)

- Issue termination `npx vitest run tests/compare-sneakerping.route.test.ts
  --reporter=basic`: FAILED once — vitest 4.1.11 dropped the `basic` reporter
  (`Error: Failed to load custom Reporter from basic`); re-run with the
  vitest-4 spelling `--reporter=dot`: 5/5 passed.
- Affected suite `npx vitest run --configLoader runner --project node --changed
  origin/main`: 386 files / 4,624 tests, all passed (~100s, VITEST_MAX_WORKERS=2).
- Scoped touched-test run (compare-sneakerping + customer-claim-surface-registry
  + sneaker-resale, node project): 3 files / 24 tests, all passed.
- `sgscan --base origin/main`: "No new security findings." (exit 0).
- Pre-merge live state (the gap this PR closes): sitemap.xml contains 0
  `compare/sneakerping`; https://0509.io/compare/sneakerping → 404. The issue's
  two verify curls are post-merge checks by nature and cannot pass before deploy.

## Recovery receipts (2026-09-13, post-rebase onto f8ec9e8e2 = current origin/main)

The unit's first run died (success/0) after the work commits; the salvage banked
`wip/pi-issue-0509-3302-20260912T172653Z` and this worktree held the 4 work
commits. This recovery session: rebased the 4 commits onto f8ec9e8e2 (clean,
zero upstream drift on the 12 touched files), then re-verified everything:

- Termination, as written in the issue (`--reporter=basic`): STILL fails —
  vitest 4.1.11 dropped the built-in `basic` reporter (`Error: Failed to load
  custom Reporter from basic` / `Failed to load url basic`, Startup Error,
  exit 1). Same file, vitest-4 spelling (`--reporter=dot`): 5/5 passed, exit 0
  (1.89s). The issue's vitest command predates the vitest-4 bump; the test
  itself is what the criterion means and it passes.
- Affected suite post-rebase (`npx vitest run --configLoader runner --project
  node --changed origin/main`, VITEST_MAX_WORKERS=2): 4,623/4,625 passed
  (386 files). 2 failures, both in `tests/launch-readiness-guard.route.test.ts`
  (self-provision + delivery_target provisioning) — PRE-EXISTING, not this
  diff: the same 2 tests fail at pristine f8ec9e8e2 in a detached worktree
  (`/tmp/issue-3302-basecheck`, 2 failed / 41 passed, exit 1), the test's
  import graph (`scripts/launch-readiness-canary.mjs`) touches none of the 12
  files this issue changes, and the redness is already tracked upstream
  (#3264 "main is red: … launch-readiness-guard … at origin/main HEAD",
  #3261). No duplicate issue filed.
- Scoped touched-test run post-rebase (compare-sneakerping +
  customer-claim-surface-registry + sneaker-resale + lane-evidence-collision,
  node project): 4 files / 26 tests, all passed (2.76s).
- `sgscan --base origin/main` (f8ec9e8e): "No new security findings." (exit 0).
- Pre-merge live state (the gap this PR closes): sitemap.xml contains 0
  `compare/sneakerping`; https://0509.io/compare/sneakerping → 404. The issue's
  two verify curls are post-merge checks by nature and cannot pass before
  deploy.

## Third recovery (2026-09-13, unit pi-issue-0509-3302, rebased onto 1cc79b200 = current origin/main)

Main moved 9 commits past f8ec9e8e2 (#3332, #3334, #3336, #3339). Squashed the
two banked wip(salvage) commits into the growth + lane-docs commits during the
rebase. Fidelity proven, not assumed: the old-branch diff
(`git diff f8ec9e8e2..afd6e2479`) and the rebased diff
(`git diff 1cc79b200..HEAD`) hash-identical via `git hash-object --stdin`
(both `ca9fddebbb8594f136426098f34e12dbbe8d13aa`), and main's 9 intervening
commits intersect the 12 touched files in ZERO paths (`comm -12`).

- Termination, as written in the issue (`--reporter=basic`): STILL fails, exit
  1 — `Startup Error: Error: Failed to load custom Reporter from basic`
  (vitest 4.1.11 dropped the built-in `basic` reporter; the issue's command
  predates the vitest-4 bump). Same file, vitest-4 spelling
  (`--reporter=dot`): 5/5 passed, exit 0 (1.78s).
- Affected suite (`npx vitest run --configLoader runner --project node
  --changed origin/main`, VITEST_MAX_WORKERS=2): 388 files / 4,637 tests, ALL
  passed (~105s). The 2 launch-readiness-guard failures the previous receipts
  proved PRE-EXISTING at f8ec9e8e2 are fixed on the new base by #3332
  (106275737, 24ce68312) — the affected suite is now fully green at 1cc79b200;
  no tracked failure remains.
- Scoped touched-test run (compare-sneakerping + customer-claim-surface-registry
  + sneaker-resale + lane-evidence-collision, node project): 4 files / 26
  tests, all passed (2.91s).
- `sgscan --base origin/main` (1cc79b20): "No new security findings." (exit 0).
- Workers project not rerun: the diff touches neither `migrations/**` nor
  `tests/integration/**` (memory-budget rule, fleet-ops#4891).
- Pre-merge live state (the gap this PR closes): sitemap.xml contains 0
  `compare/sneakerping`; https://0509.io/compare/sneakerping → 404. The
  issue's two verify curls are post-merge checks by nature and cannot pass
  before deploy.

## Issue-conditional dispositions (re-checked 2026-09-13)

- #3183 (claim-table rails): CLOSED, not merged — nothing to consume; no
  duplication.
- #3147 (per-surface og:image): CLOSED, not merged — adoption not triggered;
  this PR ships the compare-family social-card row, not #3147's per-surface
  pattern.

## Fourth recovery (2026-09-13, this unit, rebased onto ccca0c94e = current origin/main)

Main moved past 1cc79b200 (PR #3348's revert of #3345 + #3135's #2981 merge).
Fidelity proven, not assumed: `comm -12` of the 12 touched paths against
`git diff --name-only 1cc79b200..ccca0c94e` = ZERO intersection; rebase onto
ccca0c94e landed clean (2/2, no conflicts).

- Scoped touched-test run (compare-sneakerping + customer-claim-surface-registry
  + sneaker-resale + lane-evidence-collision, node project, `--reporter=dot` —
  the vitest-4 spelling; `basic` still dead in vitest 4.1.11): 4 files / 26
  tests, ALL passed (2.68s).
- Affected suite (`npx vitest run --configLoader runner --project node --changed
  origin/main`, VITEST_MAX_WORKERS=2): 388 files / 4,638 tests, ALL passed
  (112s) — fully green at ccca0c94e; the #3348 revert re-broke nothing.
- `sgscan --base origin/main` (ccca0c94e): "No new security findings." (exit 0).
- Workers project not run: diff touches neither `migrations/**` nor
  `tests/integration/**` (memory-budget rule, fleet-ops#4891).
- #3183 / #3147 re-checked 2026-09-13T08:02Z (`gh pr view --json state,mergedAt`):
  both CLOSED, `mergedAt:null` — the only-to-adopt-if-landed clauses stay
  untriggered; no duplication.
- Host-gh note: `gh pr list --sort -mergedAt` → `unknown flag: --sort` (exit 1,
  this host's gh predates the flag); merged-recent read with
  `gh pr list --state merged -L` instead.
- Pre-merge live state (the gap this PR closes): /compare/sneakerping → 404,
  sitemap.xml 0 `compare/sneakerping`. The issue's two verify curls are
  post-merge checks by nature and cannot pass before deploy.

## Continuation — pi-issue-0509-3302, 2026-09-13 (rebase + re-verification)

- Resumed from the 2 salvaged commits (feature 5b26560ac + evidence
  32c206129, both on the old-main base ccca0c94e). Rebase onto origin/main
  f026d4248 clean: `git diff --stat <base> origin/main -- <touched paths>`
  is EMPTY (zero drift under any touched file). Pushed as af8f6f242 +
  b98a1c2b8, fast-forward, no force (origin/claim/issue-3302 was exactly
  origin/main; the 6 stale-remote commits are all ancestors of main).
- Termination re-run: `npx vitest run tests/compare-sneakerping.route.test.ts`
  (no reporter flag) 5/5, exit 0. First attempt with the issue's literal
  `--reporter=basic` died at Vitest 4.1.11 startup: "Failed to load custom
  Reporter from basic" (Failed to load url basic) — the issue's flag predates
  the toolchain; the bare run is the same termination, reporter aside.
- Affected: `npx vitest run --configLoader runner --project node --changed
  origin/main` 389 files, 4648/4648, exit 0, 101.7s. No coverage, no
  typecheck locally (fleet-ops#4891); CI owns both.
- `sgscan --base origin/main` (f026d4248): "No new security findings." (exit 0).
- #3183 / #3147 re-checked 2026-09-13T15:39Z: both CLOSED, `mergedAt:null` —
  the adopt-if-landed clauses stay untriggered; no duplication.
- Acceptance re-check on the rebased tree (unchanged by the rebase): route
  pair per compare.keeptabz (canonical→EN, #1562), cited claims
  (sneakerping-citations.json: 2 dated sneakerping.com sources), switch
  framing ends in the free /search preview (GET Form → /search, "search
  preview — no account"; no demo form), #3167 footer compare rail gains
  /compare/sneakerping (renders on /sneaker-resale/* and /brands/*),
  SITEMAP_PATHS + PUBLIC_MARKDOWN_PATHS wiring, COMPARE_PRODUCT_NAMES
  og:image, G11 registry maps both new paths, #2856 mover guard scoped.
- Pre-merge live state unchanged: the two issue verify curls are post-merge
  checks by nature (see prior line); the termination vitest is the only
  pre-merge termination check and it is green.

## Reviewer round + rebase — 2026-09-13 (onto 271a90d87 = origin/main after #3360)

Main gained #3360 (Threads presence connector, issue #3254) which touches
`tests/customer-claim-surface-registry.test.ts` (presenceSources `threads`
row) — disjoint hunks from this diff's two list additions; rebase clean.
`fleet-review-arm-check` exit 0 → reviewer round ran on `devin/swe-2-max`
(the resume seat; subagent reviewer, independent of the authoring seat).

Reviewer adjudication (every finding in one bucket):

- ACT ON — `/compare` hub omitted the page: `COMPARE_PAGES` in
  `app/routes/compare.tsx` (the ItemList JSON-LD derives from it) and the
  mirror list in `tests/compare-hub.route.test.ts` both gained
  `compare/sneakerping`; stale "7 indexed" docstring corrected to 14.
- ACT ON — the rescoped #2856 guard in `tests/sneaker-resale.route.test.ts`
  was weaker than the assertion it replaced (lowercase-only, `?? ""`
  vacuous-pass, swing kicker/title/deck/source-note outside scope). Now:
  non-vacuous `toBeTruthy` on both matched regions, `/sneakerping/i`
  case-insensitive, plus data-level assertions over `copy.swingKicker/
  swingTitle/swingDeck/swingSource`, `copy.swing[]`, `copy.swingSources[]`.
- ACT ON (suggestions applied) — `sneakerping-home` citation claim extended
  to cover the 7–365-day outlook and the 7-day free trial the page cites it
  for; `sourceId` added to `sneakerpingDifferences[0]`; sneakerping row
  added to the durable #1863 canary `tests/compare-pages-sources.test.ts`;
  internal-links test now also asserts `sneaker-resale.$brand.tsx` renders
  `<MarketingFooter`; apostrophe assertion moved to the `visibleText`
  entity-normalizing convention (tests/switch-pages.route.test.ts).
- NOTED — `COMPARE_TABLE` row skipped: the hub table is a curated subset
  (keeptabz/gethookd/bigspy/minea/poweradspy are also absent); `not
  published` cells need no row.
- Pre-merge live state unchanged: /compare/sneakerping → 404, sitemap.xml 0
  `compare/sneakerping`; the two verify curls are post-merge checks.

Post-fix verification (this tree, 271a90d87 base):
- Scoped touched tests (compare-sneakerping + customer-claim-surface-registry
  + sneaker-resale + lane-evidence-collision + compare-hub +
  compare-pages-sources, node project, `--reporter=dot`): 6 files / 98
  tests, ALL passed (3.86s).

## Fifth pickup — pi-issue-0509-3302, 2026-09-13 (rebase onto edacd4aaf = origin/main after #3361)

Main gained #3361 (drill/repair-queue-jump-5810, `docs/merge-queue-jump-5810.md`
only) — `comm -12` against the 15 touched paths: ZERO intersection; rebase
clean (4/4, no conflicts).

- Termination, as written in the issue (`--reporter=basic`): FAILED, exit 1 —
  `Startup Error: Error: Failed to load custom Reporter from basic` /
  `Failed to load url basic` (vitest 4.1.11 dropped the built-in `basic`
  reporter; the issue's command predates the vitest-4 bump). Same file, bare
  run (no reporter flag): 5/5 passed, exit 0.
- Affected suite, post-reviewer-fixes — the receipt this pickup adds
  (`npx vitest run --configLoader runner --project node --changed origin/main`,
  VITEST_MAX_WORKERS=2): 390 files / 4,713 tests, ALL passed (117.2s), exit 0.
- `sgscan --base origin/main` (edacd4aa): "No new security findings." (exit 0).
- #3183 / #3147 re-checked 2026-09-13: both CLOSED, `mergedAt:null` —
  adopt-if-landed clauses stay untriggered.
- Acceptance 1–3 re-verified on the artifacts, not just tests: $locale wrapper
  = canonicalLinks + buyerSurfaceHreflangLinks, canonical→EN; citations JSON =
  2 dated sneakerping.com sources, paid tier hedged, no bare price numbers; EN
  switch framing = `<Form method=get action=/search aria-label="Public search
  preview">` + "search preview — no account" (no demo form); SITEMAP_PATHS +
  PUBLIC_MARKDOWN_PATHS + COMPARE_PRODUCT_NAMES + footer `vs SneakerPing` rail
  all present.
- Pre-merge live state unchanged: /compare/sneakerping → 404, sitemap.xml 0
  `compare/sneakerping`; the two issue verify curls are post-merge checks.

## Sixth pickup — pi-issue-0509-3302, 2026-09-13 (PR #3365 armed but BLOCKED: one tsc error)

PR #3365 (head 599ba8eed = fifth pickup) already OPEN, auto-merge armed
2026-09-13T11:33:38Z by the prior unit, but mergeState=BLOCKED: exactly two
checks failing, both on the SAME single error —

- `codex-node-checks` → Typecheck step, exit 2
- `preview-assert` → Typecheck step, exit 2 (its Build/proof steps skipped)

Annotation (both runs): "Conversion of type 'LinkDescriptor[]' to type
'Record<string, string>[]' may be a mistake because neither type sufficiently
overlaps with the other. If this was intentional, convert the expression to
'unknown' first." — tests/compare-sneakerping.route.test.ts#123. The fifth
pickup's local runs were vitest (esbuild, no typecheck); CI's tsc step was the
first typecheck this file ever saw.

Fix (the only code change of this pickup): line 123's cast becomes
`as unknown as Array<Record<string, string>>` — the compiler's own suggested
route. Downstream assertions and runtime behavior unchanged.

Inner-loop verification (this tree, sixth pickup):
- Termination AS WRITTEN in the issue (`npx vitest run
  tests/compare-sneakerping.route.test.ts --reporter=basic`): FAILED, exit 1 —
  "Startup Error: Error: Failed to load custom Reporter from basic"
  ([cause]: Failed to load url basic) — vitest 4.1.11 dropped the built-in
  `basic` reporter; the fifth pickup's finding, still true. Queued as its own
  plain issue (no labels).
- Same file, `--reporter=dot`: 1 file / 5 tests, passed, exit 0.
- Scoped touched suite (node project, `--configLoader runner`,
  VITEST_MAX_WORKERS=2 from the unit env): 6 files / 98 tests, ALL passed,
  exit 0.
- Typecheck NOT run locally per the memory-budget rule (CI owns it); the PR
  CI round-trip is the typecheck.

Acceptance 1-5 re-verified on artifacts, not vibes: the $locale wrapper uses
the same two builders as the compare.keeptabz wrapper (canonicalLinks +
buyerSurfaceHreflangLinks; canonical→EN asserted by the green route test);
sneakerping-citations.json = 2 dated sneakerping.com sources (sneakerping-home,
sneakerping-study), 0 bare $N price literals; /compare/sneakerping present in
COMPARE_PAGES (app/routes/compare.tsx), the marketing-footer vs-SneakerPing
rail, app/lib/seo.ts SITEMAP_PATHS (:1012) and the llms.txt
PUBLIC_MARKDOWN_PATHS (:98); #3147 and #3183 re-checked 2026-09-13 — both
CLOSED, mergedAt:null, so the adopt-if-landed clauses stay untriggered.

Post-merge: the armed auto-merge fires once codex-node-checks +
preview-assert go green; the issue's two verify curls are the post-merge
live checks (pre-merge live state: /compare/sneakerping → 404, sitemap 0
`compare/sneakerping`).
