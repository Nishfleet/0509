# fix(seo): @id on the shared WebPage JSON-LD — /ads/:domain and /timeline/:domain meet the BET 5(b) metric (issue #2961)

## What

The metric: every /ads/:domain and /timeline/:domain page ships at least one
`application/ld+json` block that parses as JSON and whose `@id` equals the
page's `<link rel="canonical">`.

Both routes already render a `WebPage` JSON-LD block via the shared
`webPageJsonLd()` helper in `app/lib/seo.ts` — but the block carried only
`url`, no `@id`, so the metric failed on all 161 programmatic URLs (~80% of
the root sitemap) even where the block existed. The one-line durable fix:

- `app/lib/seo.ts` — `webPageJsonLd` now states `@id: canonicalUrl(input.pathname)`
  (same value as `url`; nothing new claimed, no invented facts — ratings,
  review counts, aggregates: none added).
- `tests/seo/ads-timeline-structured-data.test.tsx` — new test (follows the
  `tests/seo/help-faq-schema.test.tsx` precedent): a real
  `renderToStaticMarkup` render of each route component with the loader-data
  fixture, no binding mocks. Asserts: the HTML contains
  `application/ld+json`, the block JSON.parses, exactly one `WebPage` block,
  and its `@id` equals the page's canonical.

The routes' `<link rel="canonical">` ships as a `tagName: "link"` descriptor
from each route's `meta` function (`links()` cannot see route params in this
router version), so the test's comparison point is that descriptor's `href` —
the same code that renders the shipped `<link rel="canonical">`.

Empty proof surfaces stay honest: the `/timeline` fixture covers both
populated and collecting states; the block's `name`/`description` come from
the same loader data the page renders, consistent with the existing
`<meta name="description">` (acceptance 2/3).

## Scope

No changes to robots.txt, canonicals, or the six sitemaps. No D1/KV/R2. No
gate-owned paths touched (no `.github/**`, no CODEOWNERS, no ratchets). No
test removals or skips. Plain git revert is the rollback.

Phase shipped: this is the whole issue (the sitemap half already shipped via
#2925; this is the structured-data half).

## Verification

```
$ bash ./scripts/ci-vitest-run.sh -- vitest run --configLoader runner tests/seo/ads-timeline-structured-data.test.tsx
 Test Files  1 passed (1)
      Tests  2 passed (2)
(exit 0)

$ bash ./scripts/ci-vitest-run.sh -- vitest run --configLoader runner tests/seo/sitemap-noindex-parity.test.ts tests/seo/llms-sitemap-reachable-sync.test.ts tests/seo/compare-canonical.test.ts tests/seo/help-faq-schema.test.tsx
 Test Files  4 passed (4)
      Tests  14 passed (14)
(exit 0)

$ bash ./scripts/ci-vitest-run.sh -- vitest run --configLoader runner --project node --changed origin/main
 Test Files  361 passed (361)
      Tests  4372 passed (4372)
(exit 0)

$ sgscan --base origin/main
No new security findings.
(exit 0)
```

run-proof: see Verification above — no new units/timers/workflows in this diff; the proof of run is the green vitest + sgscan executions recorded there.

net-positive-because: one reparented line plus a 5-line @id/url/comment block in the shared `webPageJsonLd` helper is the fix the issue's metric requires; the 220-line new test is the issue's own acceptance criterion 4.

Closes #2961

## Review round (senior seat: opencode / nemotron-3-ultra-free)

Verdict: SHIP, no blocking findings. Findings adjudication (review-adjudication):

- **Act on:** none.
- **Consider** — new test could add a `timelineData({ entries: [], collecting: true, noindex: true })` case to regression-protect acceptance 3; compliant as written, closes the gap in a follow-up if wanted.
- **Noted** — the `@id` addition widens to all 43 `webPageJsonLd` callers (every /compare, /guides, /brands, marketing route); reviewer verified no existing structured-data test deep-equals the object, and every page's @id equals its own canonical (identical to its existing `url`). Conscious, not accidental.
- **Noted** — acceptance 3 read literally: since #2881, a zero-entry timeline is always noindex and ships no JSON-LD at all (the collecting-state description ternary is dead code). Pre-existing behaviour, untouched here; the issue's `/timeline/adidas.com` example was written against the old behaviour. One-line note posted on #2961.
- **Dismissed-with-reason** — `canonicalUrl(input.pathname)` computed twice in `webPageJsonLd`: zero behavioural difference, one local const; not worth a diff.
- **Dismissed-with-reason** — JSON-LD description on /timeline is a shortened variant of the meta description ("consistent" per acceptance 2, not identical): pre-existing, not this PR's scope.
