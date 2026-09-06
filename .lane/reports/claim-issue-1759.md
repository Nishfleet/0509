# Lane evidence — claim/issue-1759 (/brands hub reachable from / and /search)

Issue: Nishfleet/0509#1759 — "/brands hub is a sitemap orphan — not linked from
/, /search, nav, or footer". Source: money-path walk + fresh site drive
2026-09-06. Claim branch: `claim/issue-1759`.

## Acceptance-criteria mapping

| Issue bullet | Implementation |
|---|---|
| `/brands` linked from homepage nav or footer | `app/components/marketing-footer.tsx` — `<Link to="/brands">Tracked brands</Link>` added to the shared marketing footer (rendered by `app/routes/marketing.tsx`, the `/` index route). |
| `/brands` linked from `/search` | `app/routes/search.tsx` — `<Link to="/brands">Browse all tracked brands</Link>` in the idle pre-search `f9-wk-acts` (issue example) **and** in the results-view header `f9-wk-sec-acts` (required by the issue's verify/termination command, which greps `/search?q=nike&country=all` — the results state; reviewed and confirmed against the literal command). |
| Crawlable `<a href="/brands">`, not a JS-only handler | React Router `Link` SSR renders a real anchor: `/` → `<a href="/brands" data-discover="true">Tracked brands</a>`; `/search` idle and `/search?q=nike&country=all` → `<a class="f9-wk-lnk" href="/brands" data-discover="true">Browse all tracked brands…</a>`. Proven live below. |
| Test assertion | `tests/funnel-seo.test.ts` footer link list now includes `/brands`; `tests/search-qprefill-ssr.test.ts` asserts `href="/brands"` + "Browse all tracked brands" on both the `?q=` results SSR and the idle no-query SSR. |

## Review finding that changed the implementation

Original diff (3 files, 8 insertions) placed the `/brands` link in the footer
and the **idle** pre-search state only. The issue's literal verify/termination
commands are:

```
curl -sS https://0509.io/ | grep -q 'href="/brands"'
curl -sS 'https://0509.io/search?q=nike&country=all' | grep -q 'href="/brands"'
```

`/search?q=nike&country=all` renders the **results** view, not the idle state;
live verification showed 0 `href="/brands"` there with the original diff, so
the issue's own close-check would fail and the measured conversion dead-end
(a landing on the common `?q=` search URL) stayed open. Fix: added the same
"Browse all tracked brands" link to the results-view header (`f9-wk-sec-acts`,
after the BET 5 brand-page handoff) so the results state also carries the hub
link. The issue's accept text explicitly sanctions the result-header
placement, so this stays inside the acceptance envelope while making the
verify/termination commands pass.

## Verification (live, 2026-09-06, local dev server `react-router dev` port 4180, E2E mode)

```
$ curl -sS http://127.0.0.1:4180/ | grep -q 'href="/brands"'; echo PASS
PASS
$ curl -sS 'http://127.0.0.1:4180/search?q=nike&country=all' | grep -q 'href="/brands"'; echo PASS
PASS
$ curl -sS http://127.0.0.1:4180/search | grep -q 'href="/brands"'; echo PASS
PASS
```

Anchor shapes: `/` → `<a href="/brands" data-discover="true">Tracked brands`;
`/search?q=nike&country=all` and `/search` → `<a class="f9-wk-lnk" href="/brands" data-discover="true">Browse all tracked brands`. Single occurrence each (no duplicates).

## Test suite

```
$ npx vitest run --configLoader runner --project node
Test Files  582 passed (582)
     Tests  6935 passed (6935)

$ npm run typecheck   # cf-typegen + react-router typegen + tsc -b
TYPECHECK_EXIT=0
```

No migration touched; node suite (incl. `tests/lane-evidence-collision.test.ts`,
`tests/search/empty-state-cross-link.test.tsx`, `tests/funnel-seo.test.ts`,
`tests/search-qprefill-ssr.test.ts`) green.

## Rollback

Remove the three added `<Link to="/brands">` elements (marketing footer, search
idle, search results header) and the test assertions.