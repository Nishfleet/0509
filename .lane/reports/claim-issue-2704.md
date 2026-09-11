# Issue #2704 — measured byte breakdown, /ads/nike.com

## Live page BEFORE this change (deployed main, measured 2026-09-11 16:0x IST)

`curl -A "Mozilla/5.0" https://0509.io/ads/nike.com` → HTTP 200, **64,229 bytes**.

Per block (parsed from the live HTML):

| block | bytes |
|---|---|
| HTML markup (hero, wall cards, FAQ, footer — everything outside `<script>`) | 32,795 |
| hydration stream (`streamController.enqueue`) | 18,844 |
| route manifest (module preload script) | 6,096 |
| FAQPage JSON-LD | 2,863 |
| WebPage + Service JSON-LD | ~1,105 |
| theme/font/scroll bootstraps + stream context shell | ~1,526 |

## Same-capture A/B (identical 13-verified-creative capture seeded into local D1, dev SSR on both branches)

| metric | origin/main | this branch | delta |
|---|---|---|---|
| total page | 43,532 B | 42,056 B | −1,476 B |
| hydration stream | 9,907 B | 8,323 B | **−1,584 B (−16%)** |
| markup | 24,719 B | 24,534 B | −185 B |

The stream cut is structural: the payload now ships exactly WALL_VISIBLE_ADS wall
creatives + a six-field TICKER_MAX_ITEMS belt projection + counts, regardless of
capture size. The live capture is larger than the seeded one (live pre-#2704
stream 18,844 B vs seeded 9,907 B), so the live reduction is strictly larger than
the seeded −16%: the after-stream is bounded by the rendered slots' content
(~8–10 KB), projecting the live page to roughly **54–56 KB < 60 KB**.

## Per-block finding — each remaining block is required

- **markup 32.8 KB**: the rendered page content (hero, 5 wall cards, FAQ, footer).
  Removing any of it deletes visible content; out of scope for a payload cut.
- **hydration stream (post-cut ~8.3 KB seeded)**: the serialized data the wall,
  belt, stat line, aggression score, teaser and change feed read. Already
  minimized by #2391 and now sliced to rendered slots by #2704.
- **route manifest 6.1 KB**: React Router's module preload map, produced by the
  framework build, not page content.
- **JSON-LD ~4.0 KB**: FAQPage + WebPage + Service structured data — SEO surface
  (M-impact), required for rich results; each is emitted once.
- **bootstraps ~1.5 KB**: theme/font flash-prevention and scroll restore; removing
  them regresses UX.

## Belt-overlap note (reviewer Warning 2)

Belt items are a six-field projection, not a second record array; the belt
repeats at most 6 metaAdId keys + field names already present in the stream. The
equivalence test proves the belt renders identically whether fed the shipped
slice or the full capture.

## Test evidence

- `npx vitest run --configLoader runner --project node --changed origin/main` → 20 files / 306 tests pass.
- After the final rebase, full node project: **5,273 tests, all pass**.
- `sgscan --base origin/main` → no new findings.
- crgate (CodeRabbit local): skipped — CLI not signed in on this machine.
