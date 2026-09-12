# Digest brief ranking — the why-this-matters weighting (BET 1)

The daily/weekly email brief ranks commercial-field changes first. Creative
churn never headlines. This page publishes the exact weighting the brief uses
so the ordering a subscriber sees is explainable from the shipped code
(`app/lib/digest-rerank.ts`) — the regression test
`tests/monitoring-brief-ranking.test.ts` pins this document to that code.

## Headline event types and their weights

Only five event types qualify as headline items. Each carries a fixed
why-this-matters type weight, ordered by how much a change in that field says
about a competitor's commercial intent:

| Rank | Event type                    | Weight |
| ---- | ----------------------------- | ------ |
| 1    | `landing_page_offer_changed`  | 1000   |
| 2    | `landing_page_cta_changed`    | 800    |
| 3    | `landing_page_url_changed`    | 700    |
| 4    | `landing_page_headline_changed` | 600  |
| 5    | `landing_page_form_changed`   | 500    |

The brief's score for an item is `type weight + priorityScore`, where
`priorityScore` is the monitor's stored 0–100 importance for that specific
change. Type weight always dominates ordering: weights start at 500, well
above any 0–100 importance, so a high-importance form change can never
leapfrog a low-importance offer change. Within one type, the higher
importance leads.

## Creative churn is not ranked

`ad_new` and `ad_inactive` carry **no type weight (0)** and are excluded from
the ranked headline stream entirely. All creative churn in a period collapses
into one counted line per watchlist — e.g. "7 new creatives, 3 retired — open
the wall to see them." — linked to the ad wall. A new ad that is actually
testing variants names the largest version split ("as 4 versions"); no figure
is ever fabricated when no variant data is stored.

## Instant alerts follow the same weighting

Instant (out-of-band) alerts are a landing-page and full-site-page privilege:

- `landing_page_*` headline events clear the per-mode importance gate
  (quiet 90 / balanced 75 / aggressive 65) using the same weighted score.
- `website_page_*` events (added / removed / changed) carry no type weight;
  their score is the raw 0–100 importance and must clear the same gate
  (their shipped importances are 80 / 80 / 82 — above balanced, below the
  quiet-mode gate).
- Every other event type — including bare `ad_new` / `ad_inactive` — has an
  infinite threshold: whatever its importance score, it can never fire an
  instant alert alone. It only ever reaches the counted digest footnote.

## Before/after values and evidence

Every headline row answers what changed from stored facts only: the change
mark renders both stored tokens ("Flat 30% off" → "Flat 50% off") only when
both sides exist and differ, both capture timestamps render when stored and
ordered, and the row links through to the watchlist event row where the
stored screenshot pair and source records live. Missing evidence is named,
never invented.
