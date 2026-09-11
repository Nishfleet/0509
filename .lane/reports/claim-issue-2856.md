# Lane evidence — claim/issue-2856 (Nishfleet/0509#2856)

Unit: pi-issue-0509-2856
Scope: /sneaker-resale cites both live below-retail cluster sources with date + link (2026-09-11 market signal).

## What changed

- `app/lib/sneaker-resale-copy.ts`: new `swingSources` field — dated, linked
  citations (one per live cluster source). Swing movers refreshed to the
  2026-09-11 signal in all 4 locales (en/de/ja/pt-br):
  - Nike — the 'Just Don't Wear It' r/stocks thread (6,561 upvotes, 1,919
    comments, posted 2026-08-30), linked to
    https://www.reddit.com/r/stocks/comments/1w2hjcm/nike_just_dont_wear_it/
  - StockX — midyear resale report (WWD, 2026-08-12), linked to
    https://wwd.com/footwear-news/sneaker-news/stockx-midyear-resale-surprises-1239106008/
  - SneakerPing retired from the "who's moving" section — it dropped out of
    the 2026-09-11 signal, so presenting it as current was stale.
  - `swingAsOfIso` bumped 2026-09-01 → 2026-09-11 (freshness guard).
- `app/components/sneaker-resale-landing.tsx`: renders `swingSources` as a
  linked, dated list under the source note (`rel="noreferrer" target="_blank"`,
  same citation pattern as compare-citations.tsx).
- `app/app.css`: `.ld-swing-sources` — same note typography as
  `.ld-pricing-note`, mono date.
- `tests/sneaker-resale.route.test.ts`: new #2856 test asserts r/stocks +
  StockX names, both outbound hrefs, each `dateTime`, and no SneakerPing —
  across every locale.

## Verification

- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 13 files / 140 tests, all pass (2026-09-11).
- `sgscan --base origin/main` → no new security findings.
- `crgate` → NOT RUN: CodeRabbit is not signed in on this machine
  (`coderabbit auth login` is interactive; auth is Nish-reserved).
- Live page pre-change (2026-09-11): `curl -sS https://0509.io/sneaker-resale`
  → StockX ×5, SneakerPing ×2, r/stocks ×0 — matches the issue's observed.

## Notes

- No `migrations/**` touched → `workers` project not run (per memory-budget
  rule); `npm run typecheck` left to CI (same rule).
- Facts only: label + URL + ISO date + counts from the signal note. No claim
  about what the thread proves.
