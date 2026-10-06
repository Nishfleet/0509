# 2026-10-06: The brand page printed raw floating point in the biggest-move line

## What customers saw

On a competitor's page, the "biggest move" line under the week's top signal could read `Mentions that matter: 3 × 0.6 = 1.7999999999999998 points, the most of anything this brand did this week.` instead of `1.8 points`.

With the v1 weights in `migrations/0006_scoring_weight_seed.sql` (bucket weights 1 to 4, multipliers 1.0, 0.9, 0.6 and 0.5), only one product shows the artifact: a weight of 3 times the `scraped_page` multiplier 0.6. That is a "Mentions that matter" or "Ad wording or offer changes" signal read from a page we scraped. Every other v1 product happens to print cleanly in JavaScript (for example `4 × 0.6` is `2.4`). Any later weight row with another multiplier, such as 0.7 (`3 × 0.7` printed `2.0999999999999996`), would have widened it.

Nothing was wrong in the ranking itself. Scores were computed and stored correctly. Only the text was wrong.

Impact: **not measured.** No customer reported it. How many brand pages showed it depends on how many weeks had a `mention_matters` or `ad_copy_change` signal from a `scraped_page` source as a brand's top signal. That has not been queried.

## Start and end (UTC)

- Wording written: 2026-09-26, commit 96ccfdf39 (#5452, merged in #5610 at 05:00).
- Start (customer-visible): 2026-09-30 18:08, when #6332 merged commit 7ea9a3751 ("Lead a competitor's page with the week's highest-weighted judged signal"), which first rendered the line on the brand page. Every push to `main` deploys, so the start is that deploy. The deploy run time was not looked up.
- Found: 2026-10-06.
- End: when the fix PR below deploys.

## Root cause

`biggestMoveView` in `app/lib/biggest-move.ts` built the sentence with `String(weight)`, `String(multiplier)` and `String(points)`, where `points = weight * multiplier`. `String()` prints the shortest string that round-trips the binary double, and `3 * 0.6` is `1.7999999999999998` as a double. The singular check compared the raw value too (`points === 1`), so a product that rounded to 1 for display would have still said "points".

Evidence:

- `git log -S'String(points)' -- app/lib/biggest-move.ts` returns only 96ccfdf39, so the line has had this shape since it was written.
- The new cases in `tests/competitor/biggest-move.test.ts` fail on the pre-fix code with `Received: "Ad wording or offer changes: 3 × 0.6 = 1.7999999999999998 points, …"` and `3 × 0.7 = 2.0999999999999996 points`.
- The sibling "How this is ranked" sheet (`app/components/how-ranked-table.tsx`) already rounded its brand lines with a local `Number(value.toFixed(2))` helper, so the two views of the same numbers had two different formatting rules, and the newer one had none.

Why the tests did not catch it: the original unit tests only used integer products (`3 × 1 = 3`, `1 × 1 = 1`). The two e2e specs that read the line, `e2e/biggest-move.spec.ts` and `e2e/j7-pricing-change.spec.ts`, used `\d+ × \d+ = \d+ points`, which does not accept a decimal at all. They can only pass when the top signal came from an `official_api` source. Both run only against production (`PLAYWRIGHT_TEST_BASE_URL`), not on the PR's `preview-assert`.

## How it was detected

Code reading during the independent review of #7203. No alert, no customer report.

## The fix

The fix PR (this branch, `fix/raw-float-biggest-move`):

- `app/lib/score-format.ts` adds `formatScore`, one `Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 })` for every score, weight and multiplier shown to people.
- `biggestMoveView` formats weight, multiplier and points with it, and picks "point" or "points" from the formatted value, so what is shown and the word agree.
- `app/components/how-ranked-table.tsx` drops its private `toFixed` helper and the two raw `String()` calls on weights and multipliers, and uses `formatScore` too, so both views share one rule.
- The two e2e regexes now accept at most two decimals (`\d+(\.\d{1,2})?`). They now pass on a correct fractional read and still fail on a raw float.

The weekly brief email (`workers/delivery/brief-template.ts`) and the home standing view were checked: they print only integer ranks and counts, never a score, so they did not need a change.

## What stops a repeat

1. **Codebase.** One formatter, `formatScore`, in `app/lib/score-format.ts`. Both places that show scoring numbers use it.
2. **Static analysis.** A new `RAW_SCORE_STRING` entry in `BANNED_SYNTAX` in `eslint.config.js` fails `String(x)` and `x.toString()` in `app/` and `workers/` when `x` is named, or ends in a property named, `points`, `weight`, `multiplier`, `score` or `total`, and fails `String(a * b)`. On the pre-fix tree it flags all three calls in `biggest-move.ts` and the weight in `how-ranked-table.tsx`. `tests/eslint-raw-score-rule.test.ts` holds the pass/fail pair. Limits: it goes by name, so a score held in a variable called something else (the multiplier list's `entry.value`, for example) is not caught. `String(a / b)` is left alone because `sign-in-sent.tsx` uses it for a whole number of minutes.
3. **Tests.** `tests/competitor/biggest-move.test.ts` covers `3 × 0.6`, `3 × 0.7`, `4 × 0.6`, integer products, and singular "1 point" for a value that rounds to 1. `tests/score-format.test.ts` covers the formatter on its own.
