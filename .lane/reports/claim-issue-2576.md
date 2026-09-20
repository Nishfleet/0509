# Lane evidence: claim/issue-2576

Issue: Nishfleet/0509#2576 — class-name CTA could still leak through the
offer-timeline transition diff (`CTA: <before> → <after>`); the #2320 display
guard covered `OfferLedgerEntry.ctaText` only.

Change:
- `isClassLikeCtaText` moved to `app/lib/offer-timeline.ts` (alongside the
  sibling validity predicates) so the ledger component can use it; the
  extractor keeps its intentional copy pinned in lockstep by
  `tests/cta-anchor-probe.test.ts`.
- `app/components/offer-timeline-ledger.tsx` now applies the guard at the
  render choke point: flat `ctaText` and each side of
  `transition.ctaText` fall back to "No clear CTA"; a null side still
  renders "—". Covers both mounts (`/ads/:domain`, `/timeline/:domain`).
- `app/routes/ads.$domain.tsx` re-exports the predicate (binding test import
  preserved) and drops the now-redundant route-level `guardedEntries` map.
- `tests/cta-anchor-probe.test.ts`: 4 new cases pin the transition-diff guard
  (before-side leak, after-side leak + null "—", genuine diff untouched,
  route-level fixture).

Verification:
- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 390 files / 4767 tests pass (includes offer-timeline.render 12,
  ads-brand-page.render 61, cta-anchor-probe 31).
- `npx vitest run --project node tests/cta-anchor-probe.test.ts` → 31/31 pass.
- `semgrep --config p/default --baseline-commit fd144e8d --quiet --metrics=off`
  → clean, exit 0.
