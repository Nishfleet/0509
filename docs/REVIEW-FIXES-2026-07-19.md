# Review Fixes — spec branch (24 WP commits), 2026-07-19

Four-domain review of the `spec/*` stack (origin/main..HEAD). Fix in this order. Same ground rules as docs/PRODUCT-READINESS-SPEC-2026-07-18.md: one fix-batch per commit, run tests, never weaken existing tests, locate code by anchor strings.

## BLOCKERS (must fix before anything merges)

### FIX-1 — WP-36 cache depth contamination fabricates customer alerts
`app/lib/ad-source.server.ts` (anchor: the shared-hit check added by WP-36, ~lines 496–513). Interactive public search writes DEEP (scroll-collected) results to the same cache key scheduled scans now read (`provider:fp:country:cursor` — no depth dimension), and the shared-hit check ignores `expiresAt`. Sequence: visitor searches a watched competitor → deep entry cached → scheduled scan consumes it → sees ads shallow scans never return → false `ad_new` instant alerts, then false "ad marked inactive" events when shallow scans miss them again. **Fix:** the cache entry row carries `routeContext` — the forceLive shared hit must accept only `watchlist_scan` / `scheduled_warmup` context entries (reject `public_search`). Add a test with a public_search-context entry being rejected.
Related (same root cause, MAJOR): interactive searches get cache HITS on shallow warmup/scan entries, defeating WP-02's depth for exactly the popular advertisers. Include depth/mode in the cache key or have interactive reads reject shallow entries.

### FIX-2 — WP-28 creative_copy events have no cross-scan suppression → 3-hourly spam
`app/lib/monitoring.server.ts` (anchors: `buildCreativeCopyDraft`, `persistScanNativeEvents`). Creative-copy drafts ride `landing_page_offer_changed`/`headline_changed` (scores 80/75 ≥ instant threshold 75) but `persistScanNativeEvents` applies no 48h suppression window and no diffHash dedupe (`dedupeEventDrafts` is within-scan only). Any ad with dynamic copy ("Ends in 3 days" → "2 days") or A/B rotation = one instant email every 3h scan. **Fix:** suppress creative_copy drafts whose (adId, from-hash, to-hash) — either direction — appeared within 48h, mirroring the proof pipeline's `hasDuplicateWithinWindow`. Test: same hook flip twice within the window → one event.

### FIX-3 — WP-03 offer regex fabricates offers from ordinary copy
`app/lib/analysis.server.ts` (anchor: the offer pattern, ~line 18). The currency character class `[₹$€£¥R$₺zł]` decomposes `R$`/`zł` into single chars, so with `/i` any `r`/`z` before a number matches: "Over 200 styles" → offer "r 200"; "Discover 12 colorways" → offer "r 12". Bare `bogo` matches inside "Bogotá". This reintroduces the fake analysis WP-03 exists to kill. **Fix:** explicit alternation `(?:\b(?:R\$|zł)|[₹$€£¥₺])\s*[\d,.]+`, applying the word boundary only to the word-led currency tokens; `\b` around `bogo`/`cod` (note `cod` currently also matches "code"). Tests: the four false-positive strings above must return null offer, while symbol-prefixed offers such as `$20`, `€10`, and `₺50` must still match.

## MAJOR — email safety (embarrassment/spam risks)

### FIX-4 — WP-25 welcome email fires for EXISTING customers on any profile edit
`app/lib/better-auth.server.ts` (anchor: `databaseHooks.user.update.after` → `maybeSendWelcomeEmail`). Any user-row update where `emailVerified` is true sends the welcome email — a months-old paying customer changing their name gets "Welcome to Five to Nine — you're in!". **Fix:** send only on the false→true transition of `emailVerified`, or gate on `user.createdAt` < 7 days. Test both paths.

### FIX-5 — WP-26 monthly recap ignores unsubscribe/opt-out entirely
`app/lib/monthly-recap.server.ts` (anchor: `unsubscribeUrl: null`). A recurring customer email with no List-Unsubscribe, no opt-out check, no email-verification check — violates the repo's own email convention. **Fix:** mirror the WP-19 scan-trouble path: verified email required, opt-out honored pre-dispatch, real target-scoped unsubscribe URL. Also soften the "numbers match your Billing page" claim (billing shows rolling 30 days; recap is calendar month; counts include baseline events and failed captures) — either align the queries or say "this calendar month".

### FIX-6 — WP-20 retroactively enables instant alerts for existing customers, and the ad_new raise is a no-op
(a) Existing Starter/Agency workspaces with no saved notification row fall through to the legacy default that WP-20 flipped to `instantEnabled: true` (anchor: `legacyWorkspaceDeliveryDefaults` in `app/lib/data/delivery-records-workspace.server.ts`, plus `buildLegacyWorkspaceConfig` in app.watchlists.tsx). Spec said NEW workspaces only. **Fix:** legacy fallback back to `false`; write an explicit config snapshot with `instantEnabled: true` at workspace creation/onboarding instead.
(b) Production `ad_new` scoring bypasses the evaluator: `getScanNativeImportanceScore` in `monitoring.server.ts` hardcodes `ad_new: 65`, so the WP-20 raise to 76 in `watch-event-evaluator.server.ts` is dead code — new-ad events still never fire instantly. **Fix:** route scan-native scores through `scoreWatchEventImportance` (or update the hardcoded map), test on the persistence path, and re-check the WP-28 flood-collapse aggregate score at the same time.

### FIX-7 — WP-29 purchase-signal regex: any "z" is a purchase signal
`app/lib/watch-event-evaluator.server.ts` (anchor: `hasPurchaseSignal`, `/[₹$€£¥₺zł]/`). Bare `z` in the char class → "Amazing new sizes" gets +10 importance and can cross the instant bar. **Fix:** `/[₹$€£¥₺]|zł/`. Add a test containing the letter z with no purchase signal.

## MAJOR — honesty/copy coupling

### FIX-8 — Agency copy still promises "75 competitors checked every 3 hours" but WP-37 delivers 25×3h + overflow 6h
Anchors: `app/routes/marketing.tsx` "75 competitors checked every 3 hours"; `app/lib/pricing.ts` agency "3-hour scans" bullets; `app/lib/public-markdown.ts` agency lines; `docs/plan-catalog.md`; tests asserting the old claim (tests/marketing-rebuild.test.ts, pricing.test.ts, public-markdown.test.ts, launch-docs.test.ts). **Fix:** update copy everywhere to "75 competitors — top 25 checked every 3 hours, the rest every 6" (or equivalent honest phrasing) and update those tests to assert the new claim. NOTE [CODEX-OVERLAP]: marketing.tsx/pricing.ts are also touched by the unmerged Codex branch — re-read current content first; this fix must land in the same deploy as WP-37 regardless.

## MAJOR — feature actually broken/unfinished

### FIX-9 — WP-38 partial-refund proration is unwired dead code
`topUpRefundQuantityAdjustment` in `evidence-usage-policies.server.ts` has no production caller; the real refund path (`applyDodoRefundWithWatchlistReconcile` in `billing-reconcile.server.ts`) still hardcodes full-refund-only clawback. **Fix:** thread the original payment amount + refund amount into the reconcile path and call the proration function; keep the manual-review fallback when amounts are missing. Integration-level test through the refund path, not just the pure function.

### FIX-10 — WP-35 daily search budget: cache hits burn budget + false reset copy + no behavioral test
`app/routes/search.tsx` (anchor: the daily budget claim before `executeSearchWithRelevance`). (a) Plain repeated queries charge the daily budget before the discovery cache is consulted — a free user refreshing a cached result burns 25/day, then the limit message falsely promises "Cached results still work". Probe `hasWarmSearchCacheEntry` first and skip the claim on warm hits. (b) The message says "resets at midnight UTC" but the bucket is a rolling 24h window — fix the copy ("~24 hours after your searches") or make it a UTC-day bucket. (c) Add the real behavioral test: 26th free search in the window is blocked with the labeled message.

### FIX-11 — WP-12/13 CSS: the two P0 fixes didn't actually take
(a) Warning strip: `.f9-status-strip.is-warning` styles the borderless wrapper; the visible child tiles paint over it — degraded still looks healthy. Style the children: `.f9-status-strip.is-warning > div { border-color: #e8c4c0; background: var(--red-wash); }`. (b) Alias block incomplete: `--f9-search-line`, `--ld-mono`, `--ld-display`, `--ld-red` still unresolvable inside `/app` (→ borderless panels, wrong fonts). Add them to the `:root` alias block (`--f9-search-line: var(--line)` etc.).

### FIX-12 — WP-16 card unification half-landed
`app/app.css`: (a) the sibling rule `.f9-app-panel, .f9-work-row { box-shadow: 0 24px 70px ... }` (anchor: `0 24px 70px`) survives — replace with the billing-card ring shadow. (b) The mobile override `.f9-app-panel { border-radius: 20px }` inside `@media (max-width: 640px)` defeats the 8px base — delete it. (c) `.f9-status-strip > div` / `.f9-proof-packet` still 22px — bring to 8px.

### FIX-13 — WP-03/11 analysis + enrichment leftovers
(a) Hook derivation on the primary DOM scrape paths runs on chrome-laced `innerText` — first lines are "Active"/"Library ID: N" → the Hook row shows chrome. Run DOM-path bodies through the same UI-line filter as the text path (anchor: `extractAdBodyLines` / `isTextCardUiLine` in `meta-library-rendered-card-parser.server.ts`) before `resolveHookAndOffer`. (b) WP-11: the single 4s revalidation both re-schedules a second full enrichment while the first is in flight (add an in-flight lease/attempt timestamp) and, when still pending, strands a permanent "Analyzing creative…" state (fall back to the honest "Not detected" copy after the revalidation, or allow one bounded follow-up).

## MINOR (batch these opportunistically)

- Avatar-as-creative fallback: only use `firstCdnUrl` when no image dimensions were measurable at all (all three extraction paths).
- `/artifacts/creatives/*` served before the rate-limit gate in `workers/app.ts` — move below it or add a per-IP cap; restrict served content-types to raster images (jpeg/png/webp/gif/avif), excluding SVG.
- Meta API interactive extra-page failures discard page 1 — wrap the extra-page loop in try/catch and return collected pages.
- `stripHeavyEmojiRuns` slices UTF-16 units — use `[...match].slice(0,2).join("")`.
- `variantCount` only parsed on Browserless/text paths — emit from the session + Quick-Action DOM scripts too.
- Pluralization missed `formatResultsPanelTitle` branches ("1 verified ads…").
- Spanish cue-list duplicate entries in `language-classifier.ts` double-count and skew the margin rule.
- WP-27 grouping only merges consecutive items — group by watchlist across the whole ranked list.
- Instant alert batch variant prints `Advertiser: <watchlist name>` when metadata.advertiser is absent — mirror the single-event gate (`delivery.server.ts`, anchor: the batched advertiser line).
- Restore the four deleted positive assertions in tests/marketing-rebuild.test.ts (their target strings still exist).
- Delete the four dead `<div className="f9-auth-gradient" aria-hidden />` nodes (auth.signup, auth.login, auth.better.magic-link, app.onboard).
- Delete dead `formatTrackingStatusSummary` in app.dashboard.tsx; wire or delete the unused icon exports (IconEmpty/IconStatus/IconBell...).
- Finish the Briefs rename inside app.digests.tsx ("Digest history", "Digest not found.") and dashboard/onboard "Market Desk Brief" strings.
- Add Bricolage 700 to the Google Fonts request in root.tsx (workspace headings declare it; only 600/800 load).
- WP-41 unfinished items from the spec: search-first secondary button on onboard, shares empty-state action, ProofGlossary on watchlist detail.
- WP-21 unfinished: heartbeat auto-degrade after 3 consecutive all-quiet dailies.
- `getUserPlan` D1 blip → paying customer briefly treated as free in search loader — catch and retain last-known plan or fail open to paid limits.
- WP-35 `LONG_WINDOW_SCOPES` now dead vs hardcoded cleanup literals — reconcile.

## Explicitly verified good (do not "fix")
- WP-19 scan-trouble email exactly-once machinery; WP-21 migration 0069 (correctly numbered, additive, NULL-safe); WP-22 Monday skip UTC logic; WP-24 deep links (scoped queries, canonical origins); WP-10 R2 path traversal/SSRF guards; the CSS purge deleted nothing still referenced; no security holes found anywhere in the stack; no dishonest test manipulation beyond the one noted assertion deletion.
