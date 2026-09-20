# Lane evidence: claim/issue-2742

Issue: Nishfleet/0509#2742 — "re-classify stored `landing_page_snapshot`
rows whose `price_tier` was computed by treating unrecognised-currency
amounts as EUR" (follow-up split out of #2433, whose fix stopped *new*
wrong tiers; this issue owns the already-persisted rows).

Verdict: **zero affected rows in production D1 — impact is negligible, so
the issue closes on the measurement per its scope item 4.** No stored
phantom-EUR tier exists to re-classify; the senior-process gate for a data
rewrite is not triggered because there is nothing to rewrite.

## Measurement (prod D1 `0509`, read-only `wrangler d1 execute --remote`, 2026-09-20 ~03:2x UTC, served_by v3-prod)

Corpus size and full `price_tier` distribution:

| price_tier   | rows |
|--------------|------|
| NULL         | 36   |
| unknown      | 30   |
| 30_to_100    | 10   |
| under_30     | 9    |
| over_250     | 5    |
| 100_to_250   | 4    |
| **total**    | **94** |

Affected-set query — `price_tier` in a named band AND `price_text`
matching any of the 13 alphabetic unrecognised markers (`RS.` / `RS ` /
`INR` / `JPY` / `CNY` / `AUD` / `CAD` / `CHF` / `SEK` / `NOK` / `DKK` /
`RUB` / `KRW`), tested case-insensitively via `UPPER(price_text) LIKE
'%<marker>%'` to replicate `toUpperCase().includes(marker)` in
`parsePriceToEur` exactly:

    SELECT price_text, price_tier, COUNT(*) FROM landing_page_snapshot
    WHERE price_tier IN ('under_30','30_to_100','100_to_250','over_250')
      AND (UPPER(price_text) LIKE '%RS.%' OR UPPER(price_text) LIKE '%RS %'
           OR UPPER(price_text) LIKE '%INR%' OR UPPER(price_text) LIKE '%JPY%'
           OR UPPER(price_text) LIKE '%CNY%' OR UPPER(price_text) LIKE '%AUD%'
           OR UPPER(price_text) LIKE '%CAD%' OR UPPER(price_text) LIKE '%CHF%'
           OR UPPER(price_text) LIKE '%SEK%' OR UPPER(price_text) LIKE '%NOK%'
           OR UPPER(price_text) LIKE '%DKK%' OR UPPER(price_text) LIKE '%RUB%'
           OR UPPER(price_text) LIKE '%KRW%')
    GROUP BY price_text, price_tier;

Result: **0 rows.**

Cross-checks, all consistent with zero stored damage:

- The same marker predicate run WITHOUT the named-band filter (any
  `price_tier`, plus the always-working `₹`/`¥` symbols) returns exactly
  2 rows in the entire table — `Starting at ₹1500` (captured
  2026-09-11T04:02:21Z) and `Starting at ₹600` (2026-09-15T04:02:05Z),
  both already `price_tier='unknown'`. No `Rs`/`INR`/`JPY`/`CNY`/`AUD`/
  `CAD`/`CHF`/`SEK`/`NOK`/`DKK`/`RUB`/`KRW` row exists in the corpus at
  all, in any tier.
- Full enumeration of every `price_text` value in the four named bands
  (21 distinct strings over 28 rows): all are `$…`, `£…`, `€…`, or
  percent-off promo strings — none carries an unrecognised marker.
- `price_tier` is written only at INSERT time via `extractPriceTier`
  (`app/lib/data/ads.server.ts`), which post-#2433 (merged 2026-09-11,
  commit 82ff523ef) returns `unknown` for every marker above — so a
  marker row in a named band can only be a pre-fix write, and none exist.

Why the exposure was nil: the bug window ran from the guard's
introduction (#1279 phase 1) to the #2433 merge on 2026-09-11, but the
tracked-competitor landing-page corpus simply never captured a
Rs/INR/JPY/etc. price in that window — the digest's input pages are
EUR/USD/GBP-denominated. The digest "Value-tier swing" section
(`delivery.server.ts` → `loadPriceTierSwing`) reads this same column, so
with zero inflated rows there is no tier-movement overstatement to
correct either.

## Incidental finding (filed separately, out of this issue's scope)

The named-band enumeration surfaced two *different* extractor
misclassification patterns in stored rows — percent-off strings parsed as
prices (`"30% Off"` → `30_to_100`, 12 of 28 named-band rows) and
decimal-comma prices read as thousands (`"€34,90"` → `over_250`). These
are not the unrecognised-currency bug this issue owns; reported as
Nishfleet/0509#3748 for its own fix cycle.
