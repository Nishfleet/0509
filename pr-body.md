fix(seo): canonicalize duplicate /compare/* pairs to specific siblings (issue #1481)

## What changed

Two pairs of `/compare/*` URLs shipped in the sitemap at identical priority
(0.7) with no canonical disambiguation, splitting Google PageRank between
near-identical "X alternative" SERP targets:

- `/compare/visualping`  -> canonicalizes to `/compare/visualping-ad-library`
- `/compare/foreplay`    -> canonicalizes to `/compare/foreplay-spyder`

The winner of each pair is the more specific URL (names the narrower buyer
intent). The generic loser:
- keeps its registered route and still renders HTTP 200 (existing backlinks and
  `/switch/*` links never 404),
- carries a `rel=canonical` pointing at the specific sibling,
- is dropped from the sitemap and from the `/compare` hub + footer nav.

Each duplicated pair's locale-prefixed variants follow the EN URLs out of the
locale child set (`$locale.compare.*` routes stay registered so they continue to
render 200, now canonicalizing straight at the winner — no canonical chain
through the EN loser, no hreflang cluster on a canonicalized-away page).

## Verification

Real run, `npx vitest run tests/seo/compare-canonical.test.ts`:

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  2.05s
```

Full node + workers suite (both green after rebasing onto current `main`):

```
 Test Files  552 passed (552)   // --project node
      Tests  6605 passed (6605)
 Test Files  20 passed (20)     // --project workers
      Tests  114 passed (114)
```

Typecheck: `npx tsc -b` -> exit 0.
`sitemapComparePaths()` regression test asserts each `/compare/*` URL is either
unique or canonicalized to a sibling under every locale prefix, and that both
pair losers carry the winner canonical. `sgscan` on the diff: no new findings.

net-positive-because: consolidates each near-identical /compare pair into one
canonical SERP target so 0509 stops competing with itself for the "Visualping
alternative" / "Foreplay alternative" SERPs; no behavior regression (losers
keep serving HTTP 200 and stay route-registered).

loose-ends-canary: pr:nishfleet/0509#1481 canonicalize-compare-duplicates

## Closes #1481
