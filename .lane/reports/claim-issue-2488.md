# Lane evidence — claim/issue-2488

Issue: Nishfleet/0509#2488 — `isPriceDrop` compared the first regex number of
free-text offer strings, so "buy 2 get 1" → "buy 1 get 1" and "up to 70% off"
→ "up to 50% off" were counted as price drops in the public weekly post.

## Change

- `scripts/weekly-offer-moves-report.mjs`: `isPriceDrop` now extracts the
  first currency-prefixed amount plus its marker (₹, Rs, $, €, £, USD, EUR,
  GBP) via `currencyAmount()` and returns true only when both sides carry
  the SAME marker and after < before. Percent-off, BOGO, and bare-number
  texts return null — offer changes, never price drops.
- `tests/weekly-public-moves.test.ts`: two new tests pin the scenarios —
  a lone BOGO move must not produce "1 price drops", and a six-move fixture
  (percent-off pair, price→percent, $→₹ mismatch, bare numbers, ₹ drop,
  USD drop) must produce exactly "2 price drops".

## Proof

- RED: `npx vitest run tests/weekly-public-moves.test.ts` before the fix —
  2 failed / 10 passed (both new tests).
- GREEN: same command after the fix — 12 passed.
- Sibling sweep: `grep -rn "firstNumber\|isPriceDrop\|priceDrop" scripts/
  app/ workers/` — only this script carries the pattern
  (`angle-classifier.ts` has "price drop" as a marketing phrase only).
- Typecheck deferred to CI per fleet-ops#4891 worker memory budget.
