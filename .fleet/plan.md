# Issue #1996 — Phantom offer transitions from geo-variance + cookie banners

## Goal
Add a capture-validity gate ahead of offer-transition emission so that snapshot
pairs that differ only by geo locale (canonical URL path locale, e.g. `/sg/` vs
`/fr/`) or whose CTA/headline matches a known consent/ads-personalization string
become an explicit suppressed state with a reason, never a phantom offer
transition.

## Target state of `app/lib/offer-timeline.ts`

- Extend `OfferLedgerEntry` with `suppressedReason: string | null` (null = normal
  state; non-null = "capture suppressed: <reason>", with `transition` forced null).
- Add two pure detection helpers (exported for unit-testing):
  - `geoLocaleSegment(url: string): string | null` — returns the first path
    segment when it is a `SUPPORTED_COUNTRIES` code (`/sg/` -> `"sg"`, `/fr/`
    -> `"fr"`), else null. Lowercase, leading/trailing `/` stripped.
  - `isCookieBannerOrConsent(text: string | null): boolean` — true when the
    needle matches a curated list of consent/ads-personalization strings
    (includes `"publicités personnalisées"`, `"personalised"`, `"personalized"`,
    `"cookie"`, `"consent"`, `"gérer mes cookies"`, `"manage cookies"`,
    `"ad preferences"`, case-insensitive substring match).
- Add `captureValidityReason(previous: OfferLedgerEntry, firstInRun:
  OfferSnapshotInput): string | null` — returns the reason to suppress, or null
  to emit a real transition:
  - If `isGeoLocaleSegment(previous.canonicalUrl)` and
    `isGeoLocaleSegment(firstInRun.canonicalUrl)` are both non-null and different
    -> `"geo locale change"` (covers the price `$149` -> `—` disappearance).
  - Else if `isCookieBannerOrConsent(firstInRun.ctaText)` or
    `isCookieBannerOrConsent(firstInRun.headline)` -> `"cookie banner / consent string"`.
  - Else -> null (genuine change, diff normally).
- Wire the gate into `buildOfferLedger`: between the run-collapse and the
  `diffOfferBetweenStates` call, compute `captureValidityReason(previousState,
  firstInRun)`. When non-null, emit the entry with `transition: null` and
  `suppressedReason: <reason>`. When null, keep current behavior (real diff).
  The first state (no `previousState`) keeps `transition: null`,
  `suppressedReason: null` (no gate needed).

## Files to Modify
- `app/lib/offer-timeline.ts` — the gate and helpers above; `suppressedReason`
  field on `OfferLedgerEntry`.
- `app/components/offer-timeline-ledger.tsx` — when `entry.transition` is null
  AND `entry.suppressedReason` is non-null, render
  `<p className="f9-timeline-suppressed">Capture suppressed: {entry.suppressedReason}</p>`
  instead of "First offer on record."
- `app/lib/offer-timeline-agent-tools.ts` — in `entryToPayload`, when
  `entry.suppressedReason` is non-null, set `changes: null` and add a
  `suppressedReason` field to `OfferHistoryEntryPayload` so MCP consumers see
  the reason instead of fabricated field changes. `transitionToChanges` returns
  null whenever `transition` is null (already true).

## New Files
- `tests/offer-timeline-geo-variance-phantom.test.ts` — the regression test.

## Phases

- [x] phase 1: In `app/lib/offer-timeline.ts`, add `isLocaleSegment`,
  `isCookieBannerOrConsent`, and `captureValidityReason` (importing
  `SUPPORTED_COUNTRIES` from `~/lib/countries`), add `suppressedReason: string | null` to `OfferLedgerEntry`, and wire the gate into
  `buildOfferLedger` so a geo-variance or cookie-banner pair emits a
  suppressed state (transition null, reason set) and never an offer transition.
- [x] phase 2: In `app/components/offer-timeline-ledger.tsx`, render
  "Capture suppressed: <reason>" when `transition` is null and
  `suppressedReason` is non-null (in place of "First offer on record."); in
  `app/lib/offer-timeline-agent-tools.ts`, add `suppressedReason` to
  `OfferHistoryEntryPayload` and surface it (changes null) so MCP consumers
  report the suppressed reason instead of phantom field changes.
- [x] phase 3: Add `tests/offer-timeline-geo-variance-phantom.test.ts` (method
  `@2026-08-09`: buildOfferLedger-based): feed the real sg (`https://www.nike.com/sg/`,
  7 Sept, CTA "Shop Now", "$149", "Nike. Just Do It. Nike.com") + fr
  (`https://www.nike.com/fr/`, 8 Sept, CTA
  "En savoir plus sur les publicités personnalisées", price "—") pair and assert
  NO offer transition is emitted — the pair is recorded suppressed with a
  geo-locale reason (transition null, suppressedReason set); AND
  assert a genuine same-geo price edit (`/sg/` -> `/sg/`, price `$149` -> `$129`)
  still emits exactly one transition. This test fails on current main
  (the pair currently diffs to Headline/CTA/Price "changed") and passes once the
  gate lands.
- [x] phase 4: Keep existing suites green after the `OfferLedgerEntry`
  `suppressedReason` shape change: update `tests/offer-timeline.render.test.tsx`
  (the `entry()` literal helper needs `suppressedReason: null`; add a case that
  renders a suppressed entry), and confirm `tests/offer-timeline.test.ts`,
  `tests/offer-timeline-agent-tools.test.ts`,
  `tests/offer-timeline.server.test.ts` still pass (they build entries via
  `buildOfferLedger`, which now populates the field automatically — only the
  render helper's explicit literal breaks).
- [ ] phase 5: Run the full verification gate — `npm test` (both node + workers
  projects) and typecheck/eslint — and confirm green; verify the scripted
  test passes and produces NO migration and NO D1 DROP/rename (pure read-side
  ledger change; no `migrations/**` edit).

## Risks
- The `entry()` literal helper in `tests/offer-timeline.render.test.tsx` will not
  type-check until `suppressedReason: null` is added — change it in phase 4, not
  phase 1, so the regression test in phase 3 remains the first signal.
- `isLocaleSegment` must only treat path segments that match a real
  `SUPPORTED_COUNTRIES` code as locales, so a genuine `/fr/`-vs-`/sg/` product-page
  swap is not wrongly suppressed while non-locale path changes still diff.
- The cookie-banner list must be broad enough to catch the French
  `"En savoir plus sur les publicités personnalisées"` string and the
  English `"Shop Now"`-style banner CTAs, without matching legit offer CTA
  verbs — put the banner strings on the known-consent list, not generic CTAs.
- Do not suppress a genuine same-geo change: the gate must return null (real
  diff) whenever locale segments are equal and no banner string matches.
- `OfferLedgerEntry` consumers beyond the four named files (search for
  `transition:`/`OfferLedgerEntry` usages) must not break from the new optional
  `suppressedReason` field; it is optional to keep back-compat.