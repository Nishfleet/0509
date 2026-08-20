# Public search — `/search`

The core feature, usable anonymously. Route: `app/routes/search.tsx`.

Pure SSR GET: the loader reads the query params and renders everything, with no client fetch
for results. curl sees the full answer.

## How users reach it

Submit the hero form on `/`, follow `Try with Nykaa`, or open `/search` directly.

## How to drive it

1. `GET /search` — page `<h1 class="f9-wk-title">` reads `Find competitor ads`.
2. The command form is `<Form method="get">` with hidden `mode=advertiser` and
   `trackingRole=competitor`, one text input labelled `Competitor website`
   (`name="website"`, placeholder `https://competitor.com`), and the submit button `See ads`.
3. Optional filters sit behind a `<details>` whose `<summary>` reads `Refine search`; inside is
   `role="group" aria-label="Search filters"` with selects for country, platform, creativeType,
   status, firstSeenFrom, lastSeenFrom.
4. Submit a website, or request the URL directly: `/search?website=<domain>`.
5. Results render in `<section class="f9-results-panel">`, the list is
   `aria-label="Search results"`, rows are `.f9-wk-row` with `.f9-wk-rowlink`, and the evidence
   pane is `#selected-proof` (class `f9-proof-summary`). The top-ranked ad is selected on the
   server, so `#selected-proof` is present in the first SSR response; clicking a row adds
   `?selected=<metaAdId>` and moves focus into the pane. A `role="status"` live region
   announces the result count.

```bash
curl -fsS 'http://127.0.0.1:4179/search?website=not-a-domain' -o /tmp/verify-0509/search-invalid.html
grep -o 'data-f9-result-source="[^"]*"' /tmp/verify-0509/search-invalid.html
grep -c 'That website looks incomplete. Add the full domain, like brand.com.' /tmp/verify-0509/search-invalid.html
```

## What proves success

`.f9-results-panel` carries the machine-readable verdict — this is the canonical signal:
`data-f9-result-source`, `data-f9-result-cache-status`, `data-f9-result-empty-reason`.

Deterministic on a plain anonymous request:

- `/search?website=not-a-domain` → 200; `role="alert"` reading
  `That website looks incomplete. Add the full domain, like brand.com.`; the input carries
  `aria-invalid="true"`; section heading `Enter a competitor website`;
  `data-f9-result-source="demo"`, `data-f9-result-cache-status="none"`.
- `/search?website=nykaa.com` → 200, panel present, `data-f9-result-source="demo"` (the local
  server has no provider binding, and the page says so honestly).

The seeded fixture states — `nykaa.com` (result link `Nykaa` / `Festive glow sale`,
`#selected-proof` headings `Nykaa` and `Festive glow sale`), `fresh-empty.example` (heading
`No verified ads found for fresh-empty.example`), `stale.example` (heading
`Search preview is temporarily unavailable`), all with
`data-f9-result-source="meta_library_browser"` — only appear through the release harness
(`npm run e2e:local:release`). Do not hand-forge the test-mode header to reach them.

Result headings come from `app/lib/search-display.ts` and `app/lib/search-answer.ts`; a market
scope is appended when the search names a country (`… across all countries` for the
all-countries view). The production suite asserts `1 verified ad linked to nykaa.com` against
`https://0509.io`, not against the local server.

## Signed-in extras on the same route

`/search` also serves POST intents that require a session (`save-query`, `create-watchlist`).
A successful watchlist save redirects to `/app/watchlists?watchlist=<id>`. Anonymous drives
cannot reach these.
