# Lane evidence — claim/issue-3019 (Nishfleet/0509#3019)

## Task
seo honesty: verify or retire /compare/pulzifi and /compare/spyland — no primary
source confirms either product exists.

## Live re-verification (2026-09-11, this lane)

- `curl -sIL https://pulzifi.com/` → HTTP 200; `https://pulzifi.com/pricing` →
  HTTP 200, prints Free $0/mo, Starter $27/mo (Annual $264/yr),
  Professional $54/mo (Annual $552/yr), Enterprise custom.
- `curl -sIL https://spyland.ing/` → HTTP 200; title "SpyLand.ing - Track
  competitor landing pages"; pricing section prints Free "$0 / month" with
  "Weekly content checks"; FAQ: "The Free plan checks weekly. Solo and Business
  check daily." Dollar prices for Solo/Business do NOT appear on the page
  (paid plans chosen from workspace, billed monthly).

Verdict: both vendors exist with live first-party sources. Keep both pages
(acceptance path a) — the #2835 resolution already landed the cited-source +
staleness-test end state; this lane re-verified live and found one residual
honesty bug.

## Changes

- `app/data/compare/spyland-citations.json` — corrected the `spyland-pricing`
  claim: it asserted published "Solo ($10/mo) and Business ($49/mo)" prices the
  cited source does not print. Claim now matches the verified source; `checked`
  bumped to 2026-09-11.
- `app/data/compare/pulzifi-citations.json` — claims still accurate;
  `checked` bumped to 2026-09-11.
- `docs/compare-spyland-source.md`, `docs/compare-pulzifi-source.md` —
  appended "Re-verified 2026-09-11 (issue #3019)" entries.
- Route source-verification comments on the EN routes and both $locale
  children — added #3019 and the 2026-09-11 re-verification date.

## Staleness gating (already landed, confirmed)

- `tests/unit/compare-phantom-vendors.test.ts` (issue #2835) pins: first-party
  citation on the vendor domain, `checked` >= 2026-09-11, sources footer links
  the vendor domain, source doc records every cited URL + check date, both
  paths in `SITEMAP_PATHS`, EN + locale routes registered.
- `tests/compare-citations.test.ts` + `tests/compare-pages-sources.test.ts`
  (issue #2958 / PR #2999) render as-of dates beside each cited claim.

## Test run

- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 11 files / 176 tests passed (includes compare-phantom-vendors,
  compare-citations, compare-pages-sources).

## Out of scope noted

- `/compare` hub table reads "not published" for Pulzifi's list price although
  pulzifi.com/pricing publishes tiers — under-claim, not a phantom claim;
  changing the "Price of knowing" table is competitor-fairness prose on a
  second surface. Filed as a follow-up issue instead of expanding scope.
