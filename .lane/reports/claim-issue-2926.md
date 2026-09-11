# claim/issue-2926 — /sneaker-resale SneakerPing attribution cleanup

## What the issue asked
Live /sneaker-resale pinned its 59.5%-below-retail stat to SneakerPing, which the
2026-09-11 market signal no longer corroborates ("SneakerPing dropped out").

## What I found
- The page copy was already re-anchored on main by aad07dde0 (issue #2856):
  swing movers = Nike r/stocks thread + StockX midyear resale report (WWD),
  swingSources carry dated outbound links, swingAsOfIso = 2026-09-11, and the
  route test asserts `not.toContain("SneakerPing")` in all four locales. The
  issue observed stale prod — aad07dde0 merged 08:07Z, the issue was cut 10:38Z
  while deploy runs were queued/cancelled.
- Residual in-repo attribution: `data/seed-lists/sneaker-resale.json` still
  seeded sneakerping.com as a cluster brand and its sourceNote still asserted
  "SneakerPing 59.5% below retail" as the cluster basis. The seed entry also
  drives the /ads/sneakerping.com → /search?q=sneakerping.com retire-redirect —
  the exact dead-end the issue names.

## What I changed
- Removed `{sneakerping.com}` from the seed domains (24 now) and refreshed
  sourceNote/asOf to the 2026-09-11 signal. By the list's own rule ("market-
  signal cluster names plus established Meta advertisers") SneakerPing no
  longer qualifies: dropped from the signal AND classified no-coverage on
  2026-09-07 (KNOWN_NO_COVERAGE).
- Canary: KNOWN_NO_COVERAGE emptied (its only member left the list); the
  classification mechanism stays for future probed no-coverage brands.
- Tests: sitemap-timeline-cohort exclusion exemplar sneakerping.com →
  finishline.com (new last seed domain); cohort test name 25→24-domain;
  hub-links doc comment updated.

## Proof
- `npx vitest run --configLoader runner --project node --changed origin/main` →
  28 files / 445 tests pass.
- Explicit: sitemap-timeline-cohort + sneaker-resale-cohort +
  sneaker-resale-hub-links + sneaker-resale.route + sneaker-resale-backfill +
  ads-domain-publisher → 125 tests pass.
- `node --check scripts/canary-sneaker-resale-recall.mjs` → OK.
- `node -e` seed list parse → 24 domains, asOf 2026-09-11.
- Live verify (`curl 0509.io/sneaker-resale | grep -ci sneakerping` → 0) flips
  when the in-flight deploy of aad07dde0 lands; it is a deploy-lag artifact,
  not a code defect.
