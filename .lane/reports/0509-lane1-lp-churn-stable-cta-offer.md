# Lane 1 report — churn-stable CTA and offer comparison

Branch: `0509-lane1-lp-churn-stable-cta-offer` · PR: https://github.com/Nishfleet/0509/pull/762
Item: Importance/noise filter on LP changes — suppress CSS/script/ad-slot churn; alert only on offer/price/CTA/copy-structure.

## Outcome

Landed the missing half of the LP change noise filter. PR #640 (merged) already
made the headline hash churn-stable and stripped CSS/script/ad-slot churn at
extraction, but CTA and price/offer text were still compared raw between scans.
A "Claim offer · 00:59:59" CTA or an "Only 3 left · ₹499" price line fired a
customer-visible CTA/offer event on every scan, even though the page's own copy
never changed.

The same fix already existed as an unmerged orphan branch
(`0509-lane1-lp-cta-offer-churn-filter`, commit `8a50492c`, no PR ever opened).
Cherry-picked onto fresh origin/main, extended with no extra scope.

## Changes (owned files)

- `app/lib/normalize.ts` — export the existing churn-token stripper as a
  null-safe `stripChurnTokens` (renamed from the headline-internal helper) so
  CTA/offer comparison reuses the identical countdown/date/audience/inventory
  patterns the headline hash already uses.
- `app/lib/watch-event-evaluator.server.ts` — `buildFieldChangeDraft` compares
  `ctaText` and `priceText` via the churn-stable value (change test AND
  diffHash); raw values are still stored in event metadata for display and
  evidence, matching the headline raw/normalized split.
- `tests/normalize.test.ts`, `tests/watch-event-evaluator.test.ts` — test cases
  for countdown/date/inventory churn in CTA and price staying silent while real
  copy changes still fire.

## Validation

- `npx vitest run ... tests/normalize.test.ts tests/watch-event-evaluator.test.ts` — 55/55 pass
- `npm test` — 437 files / 5035 tests pass
- `npm run typecheck` — exit 0
- Branch pushed, PR #762 opened against main.