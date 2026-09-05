## Why

The `/ads/:domain` `ld-ticker-belt` sliced the first 6 cached ads in recency order without dropping duplicate bodies. When one body has multiple ad variants in the wall, a first-time visitor read the same line 3–4× in a 6-slot strip (notion.so 4/6, allbirds.com 5/6, nykaa.com 5/6, mamaearth.com 5/6, atlassian.com 5/6) and concluded the wall was shorter than the by-the-numbers header claims. `/ads/:domain` is the only programmatic SEO surface, so this is the first impression for every organic landing visitor.

## Scope

- `app/lib/ticker-dedup.ts` (new): `normalizeTickerBody` (lowercase, collapse whitespace, strip trailing punctuation) and `dedupeTickerBodies` (drop any second occurrence of a normalized body, prefer the longest raw variant, preserve first-seen order).
- `app/components/ads/brand-ticker.tsx`: build the full candidate set, dedup by body, then slice to `TICKER_MAX_ITEMS` (6). Slicing after dedup means the 6 visible slots are 6 distinct bodies when the wall has ≥6 distinct bodies; a wall with fewer renders an honestly shorter strip.
- `app/routes/marketing.tsx`: route the home `f9-ads-ticker` through the same helper so the home belt stays deduped if it ever sources ad text (no-op on today's static rows).
- `tests/ads-domain-ticker-dedup.test.tsx` (new): renders each of the 8 populated brand routes with a fixture cache mirroring the live duplicate pattern and asserts a 6-of-6 distinct first cycle, plus empty-state, short-wall, source-tag/aria-hidden, and helper unit cases.

## Tradeoffs

Dedup runs before the slice, so a wall with fewer than 6 distinct bodies renders a shorter strip rather than padding with repeats. That is the honest behavior the issue asks for.

## Blast Radius

Only the ticker belt render path on `/ads/:domain` and the home marquee. No D1, no auth, no billing, no gate-owned CI path. The empty-state path (no ads on record) still returns null and renders the existing fallback.

## Verification

- `npx vitest run --configLoader runner --project node tests/ads-domain-ticker-dedup.test.tsx` → 17 passed.
- Full node project suite: `npx vitest run --configLoader runner --project node` → 541 files, 6517 tests passed.
- `npx tsc -b` → clean (exit 0).
- `sgscan` → no new security findings.
- `fleet-no-agent-names-check` → OK. `fleet-wipe-lessons-check scan` → clean.

Closes #1496
