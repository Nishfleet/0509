# IMPORTANCE/NOISE FILTER ON LP CHANGES — already implemented and merged (PR #640)

**Status: evidence record — the item is implemented in merged PR #640 on current
main. No product code touched by this lane.**

Branch: `report/lane1-lp-noise-filter`
Base: `origin/main` at `7e7c2bc0` (#716)

## Item

- [ ] Importance/noise filter on LP changes — suppress CSS/script/ad-slot churn;
      alert only on offer/price/CTA/copy-structure

## Verdict

The item is **already implemented and merged to main** by PR #640
(`feat(lp): noise-filter landing-page changes — ad-slot suppression +
churn-stable headline hash`, commit `e6610a69`, landed 2026-08-14). The
implementation is present on the current main tip (`7e7c2bc0`, #716) with no
later commits touching any of its files:

- `git log 7e7c2bc0 -- app/lib/landing-page-signals.server.ts
  app/lib/normalize.ts app/lib/watch-event-evaluator.server.ts` — the newest
  commit on all three files is `e6610a69` (#640) itself.

## What PR #640 implements (acceptance mapping)

The item's three noise sources are each handled, and the alert surface is
already field-only:

- **CSS/script churn suppressed** — `removeNonVisibleElements`
  (`app/lib/landing-page-signals.server.ts`) strips `script`/`style`/`template`
  (plus `noscript` in rendered captures) from all signal extraction, so
  stylesheet or script changes can never change `ctaText`, `priceText`, or
  `formPresent`. Shell detection (`hasMeaningfulLandingPageBodyText`) applies
  the same strip, so SPA shell placeholders do not read as copy changes.
- **Ad-slot churn suppressed** — `stripAdSlotRegions` (extractor v4,
  `lp-signals-v4`): ad containers are removed from the HTML before any signal
  extraction, keyed on id/class marker tokens (`adslot`, `adunit`, `adsbygoogle`,
  `adsense`, `googleads`, `doubleclick`, `dfp`, `taboola`, `outbrain`, `criteo`,
  `prebid`, `affiliate`, …), bare ad frames (`iframe`, `fencedframe`, `amp-ad`),
  and sponsored blocks. A bounded region scan (`AD_SLOT_REGION_SCAN_LIMIT`,
  24 KiB) fails safe: an unclosed ad region is kept rather than eating real
  copy, and `script`/`style`/`template` text is opaque to the pre-pass so a JS
  string like `<div class="ad">` can never trigger a strip.
- **Headline churn suppressed** — `normalizeHeadline`
  (`app/lib/normalize.ts`) strips countdown timers (`00:59:59`), rolling
  calendar dates (`aug 12`, `12/08/2026`), live audience counters (`12 people
  viewing now`), and live inventory/urgency counters (`only 3 left`, `120 sold`)
  from the **comparison hash only**; `raw`/`normalized` keep the full text for
  display and evidence. Real copy rewrites still fire headline events.
- **Alert only on offer/price/CTA/copy-structure** — the alert surface is
  exactly the field-diff events: `landing_page_headline_changed`,
  `landing_page_offer_changed`, `landing_page_cta_changed`,
  `landing_page_form_changed` (plus `landing_page_url_changed`). There is no
  raw-HTML or visual-diff event type anywhere in `WATCH_EVENT_TYPES`
  (`app/lib/types.ts`), so a CSS/script/ad-slot-only change cannot reach a
  customer alert — there is no event to emit it through.
- **Rollout boundary guard** — the extractor-version bump (`lp-signals-v4`)
  nulls `ctaText`/`priceText`/`formPresent` for one scan when the previous
  proof was captured by an older extractor, so the ad-suppression rollout
  itself never fabricates a one-time offer/CTA/form event
  (`evaluateProofBackedEvents`, `app/lib/watch-event-evaluator.server.ts`).

## Verification run (this lane)

Run on current main in this worktree (no product changes; report branch only):

```
$ npx vitest run tests/landing-page-signals.test.ts tests/normalize.test.ts tests/watch-event-evaluator.test.ts
 Test Files  3 passed (3)
      Tests  98 passed (98)
```

- `tests/landing-page-signals.test.ts` — **52 tests**, including the ad-slot
  suppression cases: "ignores rotating ad-slot creative in div ad containers",
  "ignores google adsense and sponsored ad blocks", "ignores ad iframes and
  amp-ad elements", "strips nested divs inside an ad container", "keeps the
  page intact when an ad region never closes", "keeps content inside ad-token
  lookalike words".
- `tests/normalize.test.ts` — **33 tests**, including the churn-stable hash
  cases: "keeps countdown timer ticks from changing the comparison hash",
  "keeps rolling calendar dates from changing the comparison hash", "keeps live
  inventory and audience counters from changing the comparison hash", "still
  fires when the headline copy actually changes".
- `tests/watch-event-evaluator.test.ts` — **13 tests**, including "does not
  emit a form change across extractor-version boundaries", "does not emit CTA
  or offer changes across extractor-version boundaries", "suppresses A/B
  flip-flops", "keeps suppressing daily repeats".

PR #640's own merge record reports 427 files / 4905 tests green plus typecheck
green at merge time.

## Why no new product PR was opened

The packet requires landing the item or reporting plainly why it cannot be
done. The item is already landed: PR #640 is merged into main, shipped ahead of
this lane, and its behavior is test-pinned on the current tip. A second PR
re-implementing it would duplicate shipped work; the productive action is the
evidence record below so the backlog item can be closed.

## Files

- `.lane/reports/0509-lane1-lp-noise-filter.md` — this evidence record (the
  only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
