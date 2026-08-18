# Structured data opportunity on /search — already resolved by PRs #564 + #600

**Status: already resolved; this lane records the evidence only.**

Branch: `report/lane1-search-structured-data-already-resolved`
Base: `origin/main` at `2b91842b`

## Item

- [ ] [dogfood fce4fa3c00f1] Structured data opportunity on /search
  [dogfood 20260808T074205Z-msk2fl3n]

## Verdict

No code change was warranted. The item is already landed on `origin/main`
(and live in production) via two merged PRs:

- **PR #564** — `d1c8bd43` "fix(seo): add truthful WebPage JSON-LD", merged
  2026-08-09. Introduced the truthful WebPage JSON-LD into both halves of the
  finding's scope: `app/routes/search.tsx` (the WebPage block mirroring the
  document head) and `app/routes/auth.login.tsx` (its sibling fix).
- **PR #600** — `03bd3809` "fix(seo): emit truthful WebPage JSON-LD on /search
  (dogfood fce4fa3c00f1) (#600)", merged 2026-08-10. This is the /search half
  and names the exact dogfood id `fce4fa3c00f1` in its title — a duplicate of
  the /search half of #564.

Both `d1c8bd43` and `03bd3809` are ancestors of current `main` HEAD
`2b91842b`.

## Evidence on current main (this lane, 2026-08-14)

- `git merge-base --is-ancestor d1c8bd43 HEAD` → 0 (ancestor).
- `git merge-base --is-ancestor 03bd3809 HEAD` → 0 (ancestor).
- `app/routes/search.tsx` (lines ~1499–1511) renders exactly one truthful
  `application/ld+json` WebPage block via `webPageJsonLd` +
  `jsonLdScriptProps` from `app/lib/seo.ts` — same title, same description,
  same canonical URL as the meta head; `isPartOf` WebSite, `publisher`
  Organization. It deliberately states only what the idle page itself says:
  no result counts, prices, rankings, or live-scrape claims. `jsonLdScriptProps`
  `<`-escapes the payload so page data can never break out of the script
  element.
- `app/lib/seo.ts` also already carries the `webSiteJsonLd()` SearchAction
  builder used on the marketing root — the site-level search affordance is
  emitted where it belongs (the WebSite entity on `/`), not on the /search
  page itself. The /search page's own WebPage block intentionally does not
  self-declare a SearchAction; its test pins exactly one JSON-LD block.
- Regression pins on this tip (run in this worktree, no product changes):

```
$ npx vitest run tests/search-structured-data.test.ts tests/auth-login-structured-data.test.ts
 Test Files  2 passed (2)
      Tests  4 passed (4)
```

  - `tests/search-structured-data.test.ts` — "renders exactly one truthful
    WebPage JSON-LD aligned with the document head" asserts the /search
    WebPage block matches the meta head title/description, and "asserts no
    unsupported schema types or invented claims" pins that the payload never
    carries `SearchAction`, `AggregateRating`, `Product`, `Offer`, `Review`,
    `Rating`, `FAQPage`, `ItemList`, prices, or result counts.
  - `tests/auth-login-structured-data.test.ts` — same truthful WebPage shape
    for the sibling page fixed by the same PR #564.

## Prior lane record

The 2026-08-12 lane 6 recorded the same evidence in `.lane/report.md`
(commit `e0dbeb64`, PR #658), including a same-engine rerun of the dogfood
audit pipeline showing the `enhancement-7` "Structured data opportunity on
/search" finding gone from the result. This lane re-verified on the current
tip without touching that shared file (left untouched per lane contract).

## Files

- `.lane/reports/0509-lane1-search-structured-data-already-resolved.md` — this
  evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
